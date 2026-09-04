import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../entities/category.entity';

const DEFAULT_CATEGORIES = [
  ['Elektronika', 'elektronika'],
  ['Maishiy texnika', 'maishiy-texnika'],
  ['Kiyim-kechak', 'kiyim-kechak'],
  ['Uy va bog‘', 'uy-va-bog'],
] as const;

@Injectable()
export class CategorySeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(CategorySeeder.name);

  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.config.get<boolean>('SEED_DEFAULT_CATEGORIES', false)) return;
    for (const [index, [name, slug]] of DEFAULT_CATEGORIES.entries()) {
      if (await this.categories.findOne({ where: { slug } })) continue;
      await this.categories.save(
        this.categories.create({
          name,
          slug,
          parentId: null,
          iconUrl: null,
          sortOrder: index,
          isActive: true,
        }),
      );
    }
    this.logger.log('Standart kategoriyalar seed qilindi');
  }
}
