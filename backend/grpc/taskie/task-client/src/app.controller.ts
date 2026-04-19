import { Controller, Get, Param, Query, Sse } from '@nestjs/common';
import { AppService } from './app.service';
import { map } from 'rxjs';

@Controller('tasks')
export class AppController {
  constructor(private appService: AppService) {}

  @Get('submit')
  submitTask(@Query('name') name: string, @Query('duration') duration: string) {
    return this.appService.submitTask(name, parseInt(duration));
  }

  @Sse('watch/:taskId')
  watchTask(@Param('taskId') taskId: string) {
    return this.appService
      .watchTask(taskId)
      .pipe(map((update) => ({ data: update })));
  }
}
