import { logger } from "@truffle/db/logger";
const debug = logger("db:resources:projects:resolveContractInstances");

import gql from "graphql-tag";
import { delegateToSchema } from "graphql-tools";
import type * as graphql from "graphql";
import type {
  DataModel,
  NamedCollectionName,
  IdObject,
  SavedInput,
  Workspace
} from "@truffle/db/resources/types";
import { resolveNameRecords } from "./resolveNameRecords";

export async function resolveContractInstances(
  project: IdObject<"projects">,
  inputs: {
    contract?: DataModel.ResourceNameInput;
    network?: DataModel.ResourceNameInput;
  },
  context: {
    workspace: Workspace;
  },
  info: graphql.GraphQLResolveInfo
): Promise<SavedInput<"contractInstances">[]> {
  const { workspace } = context;

  const contractNameRecords = await resolveNameRecords(
    project,
    { ...inputs.contract, type: "Contract" },
    { workspace }
  );

  const contractInstances: SavedInput<"contractInstances">[] = [];
  debug("inputs %O", inputs);

  for await (const { skip, contracts } of findResourcesHistories<"contracts">({
    collectionName: "contracts",
    nameRecords: contractNameRecords,
    workspace
  })) {
    let stepContractInstances = await workspace.find("contractInstances", {
      selector: {
        "contract.id": { $in: contracts.map(({ id }) => id) }
      }
    });

    if (stepContractInstances.length === 0) {
      continue;
    }

    if (inputs.network) {
      const networks = await workspace.find(
        "networks",
        stepContractInstances.map(({ network }) => network)
      );
      debug("networks %O", networks);
      const earliest = networks
        .slice(1)
        .reduce(
          (earliest, network) =>
            earliest.historicBlock.height < network.historicBlock.height
              ? earliest
              : network,
          networks[0]
        );
      debug("earliest %O", earliest);
      const { network } = await delegateToSchema({
        schema: info.schema,
        operation: "query",
        fieldName: "project",
        returnType: info.schema.getType("Project") as graphql.GraphQLOutputType,
        args: project,
        info,
        context: { workspace },
        selectionSet: extractSelectionSet(gql`{
          network(name: "${inputs.network.name}") {
            ancestors(
              includeSelf: true
              minimumHeight: ${earliest.historicBlock.height}
            ) {
              id
            }
          }
        }`)
      });
      const ancestorIds = new Set([
        ...((network || {}).ancestors || []).map(({ id }) => id)
      ]);
      debug("ancestorIds %O", ancestorIds);
      stepContractInstances = stepContractInstances.filter(({ network }) =>
        ancestorIds.has(network.id)
      );
    }

    const byContractId = stepContractInstances.reduce(
      (byContractId, contractInstance) => ({
        ...byContractId,
        [contractInstance.contract.id]: contractInstance
      }),
      {}
    );

    const found = contracts.map(({ id }, index) =>
      id in byContractId ? index : undefined
    );

    debug("skipping found indexes: %O", found);
    skip(...found);

    contractInstances.push(...stepContractInstances);
  }

  return contractInstances;
}

async function* findResourcesHistories<N extends NamedCollectionName>(options: {
  collectionName: N;
  nameRecords: (SavedInput<"nameRecords"> | undefined)[];
  workspace: Workspace;
}): AsyncIterable<
  {
    [K in "skip" | N]: "skip" extends K
      ? (...indexes: number[]) => void
      : (IdObject<N> | undefined)[];
  }
> {
  const { collectionName, workspace } = options;
  let { nameRecords } = options;

  do {
    const skip = (...indexes: (number | undefined)[]) => {
      for (const index of indexes) {
        if (typeof index === "number") {
          nameRecords[index] = undefined;
        }
      }
    };

    // @ts-ignore
    yield {
      skip,
      [collectionName]: nameRecords.map(nameRecord =>
        nameRecord && nameRecord.resource
          ? ({ id: nameRecord.resource.id } as IdObject<N>)
          : undefined
      )
    };

    // preserving order, iterate to next set of previous records
    nameRecords = await workspace.find(
      "nameRecords",
      nameRecords.map(nameRecord =>
        nameRecord && nameRecord.previous ? nameRecord.previous : undefined
      )
    );
  } while (nameRecords.find(nameRecord => nameRecord));
}

function extractSelectionSet(document) {
  return document.definitions
    .map(({ selectionSet }) => selectionSet)
    .find(selectionSet => selectionSet);
}
