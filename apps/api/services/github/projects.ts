import { runGh } from "@api/services/github/cli.ts"

export type ProjectStatusValue = {
  id: string
  name: string
}

export type ProjectItemInfo = {
  projectId: string
  projectNumber: number
  itemId: string
  contentId: string
  repoFullName: string
  issueNumber: number
}

export async function getProjectStatusField(
  owner: string,
  number: number,
  fieldName: string,
): Promise<{ fieldId: string; options: ProjectStatusValue[] } | null> {
  if (!owner) return null
  const query = `
    query($owner: String!, $number: Int!) {
      user(login: $owner) {
        projectV2(number: $number) {
          fields(first: 100) {
            nodes {
              ... on ProjectV2Field { id name }
              ... on ProjectV2SingleSelectField { id name options { id name } }
            }
          }
        }
      }
      organization(login: $owner) {
        projectV2(number: $number) {
          fields(first: 100) {
            nodes {
              ... on ProjectV2Field { id name }
              ... on ProjectV2SingleSelectField { id name options { id name } }
            }
          }
        }
      }
    }`
  const result = await runGh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `owner=${owner}`,
    "-F",
    `number=${number}`,
  ])
  if (!result.ok) return null
  const data = JSON.parse(result.stdout)
  const project = data.user?.projectV2 ?? data.organization?.projectV2
  if (!project) return null
  const fields = project.fields.nodes as Array<{ id: string; name: string; options?: ProjectStatusValue[] }>
  const field = fields.find((f) => f.name === fieldName && f.options?.length)
  if (!field || !field.options) return null
  return { fieldId: field.id, options: field.options }
}

export async function updateProjectItemStatus(
  projectId: string,
  itemId: string,
  fieldId: string,
  optionId: string,
): Promise<boolean> {
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(
        input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }
      ) { projectV2Item { id } }
    }`
  const result = await runGh([
    "api",
    "graphql",
    "-f",
    `query=${mutation}`,
    "-f",
    `projectId=${projectId}`,
    "-f",
    `itemId=${itemId}`,
    "-f",
    `fieldId=${fieldId}`,
    "-f",
    `optionId=${optionId}`,
  ])
  return result.ok
}

export async function getIssueProjectItem(owner: string, repo: string, issueNumber: number) {
  const query = `
    query($owner: String!, $repo: String!, $issueNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $issueNumber) {
          projectItems(first: 10) {
            nodes {
              id
              project { id number }
              content { ... on Issue { id number } }
            }
          }
        }
      }
    }`
  const result = await runGh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `repo=${repo}`,
    "-F",
    `issueNumber=${issueNumber}`,
  ])
  if (!result.ok) return null
  const data = JSON.parse(result.stdout)
  const items = data.repository?.issue?.projectItems?.nodes as Array<
    { id: string; project: { id: string; number: number }; content: { id: string; number: number } }
  >
  if (!items?.length) return null
  return items[0]
}

export async function getProjectItemById(itemId: string) {
  const query = `
    query($itemId: ID!) {
      node(id: $itemId) {
        ... on ProjectV2Item {
          id
          project { id number }
          content { ... on Issue { id number repository { nameWithOwner } } }
        }
      }
    }`
  const result = await runGh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `itemId=${itemId}`,
  ])
  if (!result.ok) return null
  const data = JSON.parse(result.stdout)
  return data.node
}
