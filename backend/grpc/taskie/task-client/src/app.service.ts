import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import * as microservices from '@nestjs/microservices';
import {TaskServiceClient} from './proto/task';

@Injectable()
export class AppService implements OnModuleInit {
  private taskService: TaskServiceClient;

  constructor(
    @Inject('TASK_SERVICE') private client: microservices.ClientGrpc,
  ) {}

  onModuleInit() {
    this.taskService = this.client.getService<TaskServiceClient>('TaskService');
  }

  submitTask(name: string, durationSeconds: number) {
    return this.taskService.submitTask({ name, durationSeconds });
  }

  watchTask(taskId: string) {
    return this.taskService.watchTask({ taskId });
  }
}