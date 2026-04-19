import { Controller } from '@nestjs/common';
import { AppService } from '../app.service';
import { GrpcMethod } from '@nestjs/microservices';
import {
  type SubmitTaskRequest,
  type WatchTaskRequest,
  TaskUpdate,
} from '../proto/task';
import { Observable } from 'rxjs';

@Controller('task')
export class TaskController {
  constructor(private appService: AppService) {}

  @GrpcMethod('TaskService', 'SubmitTask')
  submitTask(data: SubmitTaskRequest) {
    return this.appService.submitTask(data);
  }

  @GrpcMethod('TaskService', 'WatchTask')
  watchTask(data: WatchTaskRequest): Observable<TaskUpdate> {
    return this.appService.watchTask(data.taskId);
  }
}
