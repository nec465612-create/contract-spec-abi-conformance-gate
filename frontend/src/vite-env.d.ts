/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTRACT_ADDRESS?: string
  readonly VITE_GENLAYER_RPC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
