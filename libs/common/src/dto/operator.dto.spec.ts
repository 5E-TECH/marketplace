import { validate } from 'class-validator';
import { CreateOperatorDto } from './operator.dto';

describe('CreateOperatorDto', () => {
  const dto = (password: string) =>
    Object.assign(new CreateOperatorDto(), {
      name: 'Operator Ismi',
      phone: '+998901234567',
      password,
    });

  it('4 belgili parolni qabul qiladi', async () => {
    await expect(validate(dto('1234'))).resolves.toHaveLength(0);
  });

  it('4 belgidan qisqa parolni rad etadi', async () => {
    const errors = await validate(dto('123'));
    expect(errors.some((error) => error.property === 'password')).toBe(true);
  });
});
