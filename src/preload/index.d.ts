import { RecompHubAPI } from '../shared/types'

declare global {
  interface Window {
    api: RecompHubAPI
  }
}

declare module '*.png' {
  const value: string
  export default value
}

