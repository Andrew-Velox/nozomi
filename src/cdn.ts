// The <script> tag build: registers <sakura-tree> and exposes the API as window.Sakura.
// The element is exported (not just imported) so the build can never treat its registration as dead code.
export { SakuraTreeElement } from "./element";
export * from "./index";
