import { Report } from '../collect';

export interface JsonPayload {
  repository: Report['repo'];
  popularity: Report['popularity'];
  activity: Report['activity'];
  issues: Report['issues'];
  releases: Report['releases'];
  timeline: Report['timeline'];
  traffic: Report['traffic'];
  errors: Report['errors'];
}

export function buildJsonPayload(report: Report): JsonPayload {
  return {
    repository: report.repo,
    popularity: report.popularity,
    activity: report.activity,
    issues: report.issues,
    releases: report.releases,
    timeline: report.timeline,
    traffic: report.traffic,
    errors: report.errors,
  };
}
