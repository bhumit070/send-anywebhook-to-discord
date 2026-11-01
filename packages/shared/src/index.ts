// Code shared by backend and frontend, so the preview renders exactly what the worker sends.
export * from './discord.js';
export * from './paths.js';
export * from './template.js';
export * from './mapping.js';
export * from './render.js';
export * from './schema-sample.js';

export interface AppConfigResponse {
  authDisabled: boolean;
  registrationEnabled: boolean;
  publicBaseUrl: string;
}
