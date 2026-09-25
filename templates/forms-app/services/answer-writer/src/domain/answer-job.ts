import { AnswerValidatorService } from './validation/answer-validator.service.ts';
import { WriterService } from './writer/writer.service.ts';

/**
 * The answer.submit handler. The job is validated again before it is stored:
 * the queue is only as trustworthy as Redis, which the public forms-api
 * writes to. An invalid job fails without retries; a valid one completes once
 * its answer is in the database.
 */
export async function handleAnswerJob(data: unknown): Promise<void> {
    await WriterService.bufferAnswer(await AnswerValidatorService.validate(data));
}
