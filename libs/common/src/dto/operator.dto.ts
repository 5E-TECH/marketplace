import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/** Sotuvchi o'z do'koniga operator (xodim) qo'shadi. */
export class CreateOperatorDto {
  @ApiProperty({ example: 'Operator Ismi' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty({ example: 'secret123' })
  @IsString()
  @MinLength(4)
  password!: string;
}
