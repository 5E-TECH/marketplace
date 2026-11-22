import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ActivityLog, LegalDocumentType, OtpPurpose, Role } from '@app/common';
import { AuthSession } from '../entities/auth-session.entity';
import { User } from '../entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { IDENTITY_DB } from '../database';
import { AffiliateAuthService } from './affiliate-auth.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
/** team/new-roles.integration.spec.ts dagi bilan bir xil: identity sxemasini DROP/CREATE qiladigan spec’lar ketma-ket. */
const IDENTITY_SCHEMA_TEST_LOCK = 2_304_003;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/** Xato javobi: status, errorCode va qo‘shimcha maydonlar. */
async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const e = error as HttpException;
    const body = e.getResponse() as Record<string, any>;
    return {
      status: e.getStatus(),
      errorCode: body.errorCode,
      extra: body.extra,
    };
  }
  throw new Error('xato kutilgan edi');
}

/** BE-06 (SOT-1): SMS kod, sotuvchi ro‘yxati va profil — haqiqiy PostgreSQL. */
describeWithPostgres('BE-06 sotuvchi SMS ro‘yxati (PostgreSQL)', () => {
  let ds: DataSource;
  let schemaLock: Client | undefined;
  let svc: AffiliateAuthService;
  const sent: Array<{ phone: string; code: string; purpose: string }> = [];
  const config = new ConfigService({
    JWT_SECRET: 'be06-test-secret',
    JWT_REFRESH_SECRET: 'be06-test-refresh',
    LEAD_PHONE_OPERATOR_CODES: '90,91,93,94,97,99,33,88,77,95,98',
  });
  const lastCode = (phone: string) =>
    [...sent].reverse().find((s) => s.phone === phone)!.code;

  beforeAll(async () => {
    if (!new URL(testDatabaseUrl!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    schemaLock = new Client({ connectionString: testDatabaseUrl });
    await schemaLock.connect();
    await schemaLock.query('SELECT pg_advisory_lock($1)', [
      IDENTITY_SCHEMA_TEST_LOCK,
    ]);
    const admin = new Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query('DROP SCHEMA IF EXISTS identity CASCADE');
    await admin.query('CREATE SCHEMA identity');
    await admin.end();
    ds = await new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      schema: 'identity',
      entities: [User, AuthSession, ActivityLog],
      migrations: IDENTITY_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    const jwt = new JwtService({ secret: 'be06-test-secret' });
    const notifications = {
      emit: (
        _p: string,
        data: { phone: string; code: string; purpose: string },
      ) => {
        sent.push(data);
        return { subscribe: () => undefined };
      },
    };
    const auth = new AuthService(
      ds.getRepository(User),
      ds.getRepository(AuthSession),
      jwt,
      config,
      ds,
      notifications as never,
    );
    svc = new AffiliateAuthService(
      ds.getRepository(User),
      auth,
      jwt,
      config,
      ds,
      notifications as never,
    );
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS identity CASCADE');
      await ds.destroy();
    }
    if (schemaLock) {
      await schemaLock.query('SELECT pg_advisory_unlock($1)', [
        IDENTITY_SCHEMA_TEST_LOCK,
      ]);
      await schemaLock.end();
    }
  });

  const register = async (phone: string) => {
    await svc.sendOtp({ phone, purpose: OtpPurpose.REGISTER });
    const { registrationToken } = (await svc.verifyOtp({
      phone,
      purpose: OtpPurpose.REGISTER,
      code: lastCode(phone),
    })) as { registrationToken: string };
    return registrationToken;
  };

  it('TC1: to‘g‘ri kod 5 daqiqa ichida → ro‘yxat yakunlandi, oferta va rozilik versiyasi va vaqti bazada', async () => {
    const phone = '+998901110001';
    await expect(
      svc.sendOtp({ phone, purpose: OtpPurpose.REGISTER }),
    ).resolves.toEqual({ expiresIn: 300, delivery: 'SENT' });
    // TC4: hodisa notification-service ga — 6 raqamli kod
    expect(sent.at(-1)).toMatchObject({ phone, purpose: 'REGISTER' });
    expect(sent.at(-1)!.code).toMatch(/^\d{6}$/);
    const [stored] = (await ds.query(
      `SELECT code_hash, expires_at - created_at AS ttl FROM identity.verification_code WHERE phone = $1`,
      [phone],
    )) as Array<{ code_hash: string; ttl: { minutes: number } }>;
    expect(stored.code_hash).not.toBe(sent.at(-1)!.code); // kod ochiq saqlanmaydi
    expect(stored.ttl.minutes).toBe(5);

    const { registrationToken } = (await svc.verifyOtp({
      phone,
      purpose: OtpPurpose.REGISTER,
      code: lastCode(phone),
    })) as { registrationToken: string };
    const auth = await svc.registerAffiliate(
      { registrationToken, offerVersion: '1.0', consentVersion: '1.0' },
      '10.0.0.1',
    );
    expect(auth.accessToken).toEqual(expect.any(String));
    const user = await ds.getRepository(User).findOneByOrFail({ phone });
    expect(user.role).toBe(Role.AFFILIATE);
    const rows = (await ds.query(
      `SELECT type, version, accepted_at IS NOT NULL AS has_time, ip FROM identity.user_agreement WHERE user_id = $1 ORDER BY type`,
      [user.id],
    )) as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        type: 'affiliate-offer',
        version: '1.0',
        has_time: true,
        ip: '10.0.0.1',
      },
      {
        type: 'personal-data-consent',
        version: '1.0',
        has_time: true,
        ip: '10.0.0.1',
      },
    ]);
    // token bir martalik — ikkinchi marta hisob yaratilmaydi
    await expect(
      errorOf(
        svc.registerAffiliate(
          { registrationToken, offerVersion: '1.0', consentVersion: '1.0' },
          null,
        ),
      ),
    ).resolves.toMatchObject({
      status: 409,
      errorCode: 'PHONE_ALREADY_REGISTERED',
    });
    // ro‘yxatdagi raqamga REGISTER kodi yuborilmaydi
    await expect(
      errorOf(svc.sendOtp({ phone, purpose: OtpPurpose.REGISTER })),
    ).resolves.toMatchObject({
      status: 409,
      errorCode: 'PHONE_ALREADY_REGISTERED',
    });
  });

  it('TC2: 6-daqiqadagi kod → 410 OTP_EXPIRED; yangi kod eskisini bekor qiladi', async () => {
    const phone = '+998901110002';
    await svc.sendOtp({ phone, purpose: OtpPurpose.REGISTER });
    const old = lastCode(phone);
    await ds.query(
      `UPDATE identity.verification_code SET expires_at = now() - interval '1 minute', created_at = now() - interval '6 minutes' WHERE phone = $1`,
      [phone],
    );
    await expect(
      errorOf(
        svc.verifyOtp({ phone, purpose: OtpPurpose.REGISTER, code: old }),
      ),
    ).resolves.toMatchObject({ status: 410, errorCode: 'OTP_EXPIRED' });
    await svc.sendOtp({ phone, purpose: OtpPurpose.REGISTER });
    await svc.sendOtp({ phone, purpose: OtpPurpose.REGISTER });
    const second = sent.filter((s) => s.phone === phone).at(-2)!.code;
    if (second !== lastCode(phone))
      await expect(
        errorOf(
          svc.verifyOtp({ phone, purpose: OtpPurpose.REGISTER, code: second }),
        ),
      ).resolves.toMatchObject({ status: 400, errorCode: 'OTP_INVALID' });
  });

  it('TC3: 3 xato → 423 OTP_BLOCKED 15 daqiqa (attemptsLeft 2, 1); blokda kod ham yuborilmaydi; blokdan keyin ishlaydi', async () => {
    const phone = '+998901110003';
    await svc.sendOtp({ phone, purpose: OtpPurpose.REGISTER });
    const wrong = lastCode(phone) === '111111' ? '222222' : '111111';
    await expect(
      errorOf(
        svc.verifyOtp({ phone, purpose: OtpPurpose.REGISTER, code: wrong }),
      ),
    ).resolves.toEqual({
      status: 400,
      errorCode: 'OTP_INVALID',
      extra: { attemptsLeft: 2 },
    });
    // yangi kod so‘ralsa ham hisob saqlanadi
    await svc.sendOtp({ phone, purpose: OtpPurpose.REGISTER });
    await expect(
      errorOf(
        svc.verifyOtp({ phone, purpose: OtpPurpose.REGISTER, code: wrong }),
      ),
    ).resolves.toMatchObject({ extra: { attemptsLeft: 1 } });
    const third = await errorOf(
      svc.verifyOtp({ phone, purpose: OtpPurpose.REGISTER, code: wrong }),
    );
    expect(third).toMatchObject({ status: 423, errorCode: 'OTP_BLOCKED' });
    expect(third.extra.retryAfterSeconds).toBe(900);
    const blocked = await errorOf(
      svc.sendOtp({ phone, purpose: OtpPurpose.REGISTER }),
    );
    expect(blocked).toMatchObject({ status: 423, errorCode: 'OTP_BLOCKED' });
    expect(blocked.extra.retryAfterSeconds).toBeGreaterThan(890);
    // 15 daqiqa o‘tdi
    await ds.query(
      `UPDATE identity.otp_state SET blocked_until = now() - interval '1 second' WHERE phone = $1`,
      [phone],
    );
    await svc.sendOtp({ phone, purpose: OtpPurpose.REGISTER });
    await expect(
      svc.verifyOtp({
        phone,
        purpose: OtpPurpose.REGISTER,
        code: lastCode(phone),
      }),
    ).resolves.toHaveProperty('registrationToken');
  });

  it('kirish (LOGIN): sotuvchi SMS kod bilan kiradi; hisob yo‘q yoki xodim — 404; boshqa operator — 400', async () => {
    const phone = '+998901110004';
    await svc.registerAffiliate(
      {
        registrationToken: await register(phone),
        offerVersion: '1.0',
        consentVersion: '1.0',
      },
      null,
    );
    await svc.sendOtp({ phone, purpose: OtpPurpose.LOGIN });
    await expect(
      svc.verifyOtp({
        phone,
        purpose: OtpPurpose.LOGIN,
        code: lastCode(phone),
      }),
    ).resolves.toHaveProperty('accessToken');
    await expect(
      errorOf(
        svc.sendOtp({ phone: '+998901119999', purpose: OtpPurpose.LOGIN }),
      ),
    ).resolves.toMatchObject({ status: 404, errorCode: 'ACCOUNT_NOT_FOUND' });
    await ds.query(
      `INSERT INTO identity.users (role, name, phone, password_hash, is_active) VALUES ('OPERATOR_LEAD', 'Op', '+998901118888', 'x', TRUE)`,
    );
    await expect(
      errorOf(
        svc.sendOtp({ phone: '+998901118888', purpose: OtpPurpose.LOGIN }),
      ),
    ).resolves.toMatchObject({ status: 404, errorCode: 'ACCOUNT_NOT_FOUND' });
    await expect(
      errorOf(
        svc.sendOtp({ phone: '+998711234567', purpose: OtpPurpose.REGISTER }),
      ),
    ).resolves.toMatchObject({
      status: 400,
      errorCode: 'PHONE_OPERATOR_INVALID',
    });
  });

  it('oferta: versiyasiz yoki eski versiya — 400 OFFER_NOT_ACCEPTED; yangi versiya e’lon qilinadi va qabul qilinadi; profil tarixi', async () => {
    const phone = '+998901110005';
    const token = await register(phone);
    await expect(
      errorOf(
        svc.registerAffiliate(
          { registrationToken: token, offerVersion: '', consentVersion: '1.0' },
          null,
        ),
      ),
    ).resolves.toMatchObject({ status: 400, errorCode: 'OFFER_NOT_ACCEPTED' });
    await expect(
      errorOf(
        svc.registerAffiliate(
          {
            registrationToken: 'eyJhbGciOiJIUzI1NiJ9.e30.x',
            offerVersion: '1.0',
            consentVersion: '1.0',
          },
          null,
        ),
      ),
    ).resolves.toMatchObject({
      status: 410,
      errorCode: 'REGISTRATION_EXPIRED',
    });
    await svc.registerAffiliate(
      { registrationToken: token, offerVersion: '1.0', consentVersion: '1.0' },
      null,
    );
    const user = await ds.getRepository(User).findOneByOrFail({ phone });

    await svc.publishLegalDocument(
      LegalDocumentType.AFFILIATE_OFFER,
      {
        version: '1.1',
        summary: [{ term: 'Haq', text: 'faqat to‘langan buyurtma uchun' }],
        sections: [],
      },
      '1',
    );
    await expect(svc.legalDocument('affiliate-offer')).resolves.toMatchObject({
      version: '1.1',
      effectiveAt: null,
    });
    await expect(
      errorOf(
        svc.acceptAgreement(
          user.id,
          { type: LegalDocumentType.AFFILIATE_OFFER, version: '1.0' },
          null,
        ),
      ),
    ).resolves.toMatchObject({ errorCode: 'OFFER_NOT_ACCEPTED' });
    const profile = await svc.acceptAgreement(
      user.id,
      { type: LegalDocumentType.AFFILIATE_OFFER, version: '1.1' },
      null,
    );
    const offers = profile.agreements.filter(
      (a) => a.type === 'affiliate-offer',
    );
    expect(offers.map((a) => [a.version, a.current])).toEqual([
      ['1.1', true],
      ['1.0', false],
    ]);
    // kelajak sanasi bilan e’lon qilingan versiya — o‘sha kungacha joriy emas
    await svc.publishLegalDocument(
      LegalDocumentType.AFFILIATE_OFFER,
      {
        version: '2.0',
        effectiveAt: new Date(Date.now() + 86_400_000).toISOString(),
        summary: [],
        sections: [],
      },
      '1',
    );
    await expect(svc.legalDocument('affiliate-offer')).resolves.toMatchObject({
      version: '1.1',
    });

    const updated = await svc.updateProfile(user.id, {
      firstName: ' Jasur ',
      lastName: 'Tursunov',
    });
    expect(updated).toMatchObject({
      firstName: 'Jasur',
      lastName: 'Tursunov',
      phone,
    });
    expect((await ds.getRepository(User).findOneByOrFail({ phone })).name).toBe(
      'Jasur Tursunov',
    );
  });
});
