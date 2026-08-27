import { BusinessException } from '@app/common';
import { AuthService } from './auth.service';

/** createOperator (C1.38) — prototip orqali (og'ir konstruktorsiz). */
function makeService(users: Record<string, jest.Mock>) {
  const svc = Object.create(AuthService.prototype) as any;
  svc.users = users;
  svc.sessions = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
  return svc as AuthService;
}

describe('AuthService — market operator (C1.38)', () => {
  it('TC1: createOperator -> OPERATOR user + shopId; parol hash; sanitize', async () => {
    const created: any[] = [];
    const users = {
      findOne: jest.fn(() => Promise.resolve(null)), // telefon band emas
      create: jest.fn((x: any) => {
        created.push(x);
        return x;
      }),
      save: jest.fn((x: any) => Promise.resolve({ id: '10', ...x })),
    };
    const svc = makeService(users);

    const res: any = await svc.createOperator('5', {
      name: 'Operator',
      phone: '+998900000000',
      password: 'secret',
    });

    expect(created[0]).toMatchObject({
      role: 'OPERATOR',
      shopId: '5',
      name: 'Operator',
      isActive: true,
    });
    // parol hash (ochiq emas)
    expect(created[0].passwordHash).toBeDefined();
    expect(created[0].passwordHash).not.toBe('secret');
    // javob sanitize (passwordHash yo'q)
    expect(res.passwordHash).toBeUndefined();
    expect(res.role).toBe('OPERATOR');
    expect(res.shopId).toBe('5');
  });

  it('band telefon -> conflict', async () => {
    const users = {
      findOne: jest.fn(() => Promise.resolve({ id: '1' })),
      create: jest.fn(),
      save: jest.fn(),
    };
    const svc = makeService(users);
    await expect(
      svc.createOperator('5', {
        name: 'X',
        phone: '+998900000000',
        password: 'secret',
      }),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it('removeOperator: boshqa do‘kon operatori -> topilmadi', async () => {
    const users = { findOne: jest.fn(() => Promise.resolve(null)) };
    const svc = makeService(users as never);
    await expect(svc.removeOperator('5', '99')).rejects.toBeInstanceOf(
      BusinessException,
    );
  });

  it('listOperators: faqat shu do‘kon operatorlari, sanitize qilingan', async () => {
    const users = {
      find: jest.fn(() =>
        Promise.resolve([
          {
            id: '10',
            role: 'OPERATOR',
            shopId: '5',
            name: 'Op1',
            passwordHash: 'hash',
          },
        ]),
      ),
    };
    const svc = makeService(users as never);
    const res: any = await svc.listOperators('5');

    expect(users.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: 'OPERATOR',
          shopId: '5',
          isDeleted: false,
        }),
      }),
    );
    expect(res).toHaveLength(1);
    expect(res[0].passwordHash).toBeUndefined(); // sanitize
  });

  it('updateOperator: faqat shu do‘kon operatorini yangilaydi', async () => {
    const operator = {
      id: '10',
      role: 'OPERATOR',
      shopId: '5',
      name: 'Eski ism',
      phone: '+998900000000',
      passwordHash: 'old-hash',
      isActive: true,
      isDeleted: false,
    };
    const users = {
      findOne: jest.fn().mockResolvedValueOnce(operator),
      save: jest.fn(async (value) => value),
    };
    const svc = makeService(users);

    const result: any = await svc.updateOperator('5', '10', {
      name: 'Yangi ism',
      isActive: false,
    });

    expect(users.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: '10', shopId: '5' }),
    });
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Yangi ism', isActive: false }),
    );
    expect(result.passwordHash).toBeUndefined();
  });

  it('updateOperator: boshqa do‘kon operatorini rad etadi', async () => {
    const users = { findOne: jest.fn().mockResolvedValue(null) };
    const svc = makeService(users);

    await expect(
      svc.updateOperator('5', '99', { name: 'Yangi ism' }),
    ).rejects.toBeInstanceOf(BusinessException);
  });
});
