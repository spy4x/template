import { createDefine } from "fresh"
import type { Api } from "./api.ts"

/** What the middleware hands every route. */
export interface State {
  /** The API, called on behalf of this request. */
  api: Api
  /** The origin the browser sees this app at, as `MpaConfig.webAppOrigin`: links start with it. */
  webAppOrigin: string
}

export const define = createDefine<State>()
