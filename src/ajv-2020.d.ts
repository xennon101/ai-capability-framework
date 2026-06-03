declare module "ajv/dist/2020.js" {
  import type { Options, ValidateFunction } from "ajv";

  export default class Ajv2020 {
    constructor(options?: Options);
    compile(schema: unknown): ValidateFunction;
  }

  export type { ValidateFunction };
}
