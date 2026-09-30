/** What the MPA needs to know about its surroundings. */
export interface MpaConfig {
  /** Where the MPA reaches the API from the server, such as `http://api:8000`. Never a browser URL. */
  apiUrl: string
  /**
   * The origin the browser sends, such as `https://app.example.com`: the same value the API derives
   * from `ENV` and `DOMAIN`, so both refuse the same cross-site posts.
   */
  webAppOrigin: string
}

/**
 * Reads the configuration from the environment: `ENV`, `DOMAIN` (as the API reads them) and
 * `API_URL`. Throws when one is missing, so a misconfigured MPA refuses to start.
 */
export function readMpaConfig(env: { get(name: string): string | undefined }): MpaConfig {
  const required = (name: string): string => {
    const value = env.get(name)
    if (!value) throw new Error(`${name} is required: the MPA cannot start without it`)
    return value
  }
  const isDev = required("ENV") === "dev"
  return {
    apiUrl: new URL(required("API_URL")).origin,
    webAppOrigin: new URL(`http${isDev ? "" : "s"}://${required("DOMAIN")}`).origin,
  }
}
