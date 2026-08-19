import { GroupListQuery } from "@domain/groups"
import { db } from "../../services/db.ts"
import { createGroupListHandler } from "../../features/groups/handlers.ts"
import type { QueryHandler } from "@platform/cqrs/types.ts"

export const groupListHandler: QueryHandler<GroupListQuery> = createGroupListHandler(db.group)
