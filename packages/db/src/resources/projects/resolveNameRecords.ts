import { logger } from "@truffle/db/logger";
const debug = logger("db:resources:projects:resolveNameRecords");

import type { IdObject, Workspace } from "@truffle/db/resources/types";

export async function resolveNameRecords(options: {
  project: IdObject<"projects">;
  name?: string;
  type?: string;
  workspace: Workspace;
}) {
  const {
    project: { id },
    name,
    type,
    workspace
  } = options;

  const results = await workspace.find("projectNames", {
    selector: {
      "project.id": id,
      "key.name": name,
      "key.type": type
    }
  });
  const nameRecordIds = results.map(({ nameRecord: { id } }) => id);
  const nameRecords = await workspace.find("nameRecords", {
    selector: {
      id: { $in: nameRecordIds }
    }
  });

  return nameRecords;
}
