import { Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service';
import { DbModule } from '../db/db.module';

@Module({
  imports: [DbModule],
  providers: [CleanupService],
})
export class CleanupModule {}
