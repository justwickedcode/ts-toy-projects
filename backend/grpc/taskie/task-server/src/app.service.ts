import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { Subject } from 'rxjs';
import {
  SubmitTaskRequest,
  SubmitTaskResponse,
  TaskUpdate,
} from './proto/task';
import { ConfigService } from '@nestjs/config';

interface TaskJobData {
  name: string;
  durationSeconds: number;
}

@Injectable()
export class AppService {
  constructor(
    @InjectQueue('tasks') private taskQueue: Queue<TaskJobData>,
    private config: ConfigService,
  ) {}

  async submitTask(task: SubmitTaskRequest): Promise<SubmitTaskResponse> {
    const job = await this.taskQueue.add('process', {
      name: task.name,
      durationSeconds: task.durationSeconds,
    });
    return { taskId: job.id! };
  }

  watchTask(taskId: string) {
    const subject = new Subject<TaskUpdate>();

    const queueEvents = new QueueEvents('tasks', {
      connection: {
        host: this.config.get<string>('REDIS_HOST', 'localhost'),
        port: this.config.get<number>('REDIS_PORT', 6379),
        password: this.config.get<string>('REDIS_PASSWORD'),
      },
    });

    queueEvents.on('progress', ({ jobId, data }) => {
      if (jobId !== taskId) return;
      subject.next({
        taskId,
        progress: data as number,
        status: 'processing',
      });
    });

    queueEvents.on('completed', ({ jobId }) => {
      if (jobId !== taskId) return;
      subject.next({ taskId, progress: 100, status: 'completed' });
      subject.complete();
      void queueEvents.close();
    });

    queueEvents.on('failed', ({ jobId }) => {
      if (jobId !== taskId) return;
      subject.error({ taskId, progress: 0, status: 'failed' });
      void queueEvents.close();
    });

    return subject.asObservable();
  }
}
