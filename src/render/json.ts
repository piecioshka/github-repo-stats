import { Report } from '../collect';

/** The JSON contract: `Report` with `repo` renamed to `repository`. */
export type JsonPayload = { repository: Report['repo'] } & Omit<Report, 'repo'>;

export function buildJsonPayload(report: Report): JsonPayload {
  const { repo: repository, ...rest } = report;
  return { repository, ...rest };
}
