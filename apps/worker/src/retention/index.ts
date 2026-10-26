import type { TaskList } from "../job-context.js";
import { deletePersonTask } from "./delete-person-job.js";
import { purgeExpiredTask } from "./purge-expired-job.js";

// The retention tasks for the worker task list: the account deletion and the hourly purge (seams S3, slot 6).
export const retentionTasks: TaskList = { delete_person: deletePersonTask, purge_expired: purgeExpiredTask };
// The one list of where a person's rows live, shared by the deletion counts and the coverage test.
export { PERSON_TABLES, countPersonRows } from "./table-list.js";
