import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

interface TaskJobData {
  taskId: string;
  name: string;
  durationSeconds: number;
}

@Processor('tasks')
export class TaskProcessor extends WorkerHost {
  async process(job: Job<TaskJobData>) {
    const delayPerStep = (job.data.durationSeconds * 1000) / 10;
    for (let progress = 0; progress <= 100; progress += 10) {
      await job.updateProgress(progress);
      await new Promise((resolve) => setTimeout(resolve, delayPerStep));
    }
  }
}
