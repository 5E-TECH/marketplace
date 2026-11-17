import { queryRows } from './query-rows';

describe('queryRows', () => {
  it('UPDATE/DELETE … RETURNING natijasi [qatorlar, soni] dan qatorlarni oladi', () => {
    expect(queryRows([[{ id: 1 }], 1])).toEqual([{ id: 1 }]);
    expect(queryRows([[], 0])).toEqual([]);
  });

  it('INSERT/SELECT natijasi o‘zgarmaydi', () => {
    expect(queryRows([{ id: 2 }])).toEqual([{ id: 2 }]);
    expect(queryRows([])).toEqual([]);
    expect(queryRows(undefined)).toEqual([]);
  });
});
