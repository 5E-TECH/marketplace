import { returningRows } from './returning-rows';

describe('returningRows', () => {
  it('UPDATE ... RETURNING: [qatorlar, soni] dan qatorlarni oladi', () => {
    expect(returningRows([[{ id: '1' }], 1])).toEqual([{ id: '1' }]);
    expect(returningRows([[], 0])).toEqual([]);
  });

  it('SELECT/INSERT natijasini o‘zgartirmaydi', () => {
    expect(returningRows([{ id: '1' }, { id: '2' }])).toEqual([
      { id: '1' },
      { id: '2' },
    ]);
    expect(returningRows([])).toEqual([]);
  });
});
