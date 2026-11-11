/** regexp-tree's parser on its own (the package's index brings its optimiser and transforms too) */
declare module 'regexp-tree/dist/parser' {
  const parser: { parse(source: string): unknown }
  export default parser
}
