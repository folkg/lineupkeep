export type UseCaseResult<A, Code extends string> =
  | { readonly type: "success"; readonly data: A }
  | { readonly type: "error"; readonly error: { readonly type: Code } };
