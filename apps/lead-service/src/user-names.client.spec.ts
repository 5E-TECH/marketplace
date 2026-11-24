import { NEVER, of, throwError } from 'rxjs';
import { IDENTITY_USER_NAMES } from '@app/common';
import { UserNamesClient } from './user-names.client';

/** BE-25 (FE-09, FE-26): ismlar identity dan; javob bo‘lmasa `#ID`. */
describe('UserNamesClient', () => {
  afterEach(() => jest.useRealTimers());

  it('bitta so‘rov, takroriy va bo‘sh ID siz; ismi yo‘q — `#ID`', async () => {
    const send = jest.fn(() =>
      of([
        { id: '41', name: 'Dilnoza R.', role: 'OPERATOR_LEAD' },
        { id: '42', name: null, role: 'AFFILIATE' },
      ]),
    );
    const name = await new UserNamesClient({ send } as never).resolve([
      '41',
      '41',
      null,
      undefined,
      '42',
      '43',
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      { cmd: IDENTITY_USER_NAMES },
      { ids: ['41', '42', '43'] },
    );
    expect([name('41'), name('42'), name('43')]).toEqual([
      'Dilnoza R.',
      '#42',
      '#43',
    ]);
  });

  it('ID yo‘q — so‘rov yo‘q; xato — `#ID`', async () => {
    const send = jest.fn(() => throwError(() => new Error('identity yo‘q')));
    const client = new UserNamesClient({ send } as never);
    await client.resolve([null]);
    expect(send).not.toHaveBeenCalled();
    expect((await client.resolve(['41']))('41')).toBe('#41');
  });

  it('identity osilib qolsa 1,5 s dan keyin `#ID` (karta kutib qolmaydi)', async () => {
    jest.useFakeTimers();
    const pending = new UserNamesClient({
      send: () => NEVER,
    } as never).resolve(['41']);
    await jest.advanceTimersByTimeAsync(1_500);
    expect((await pending)('41')).toBe('#41');
  });
});
