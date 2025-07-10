# Agent Guidelines for liteque

## Build/Test/Lint Commands
- `pnpm build` - Build TypeScript to dist/ and copy drizzle files
- `pnpm typecheck` - Type check without emitting files
- `pnpm test` - Run all tests with vitest
- `pnpm test -- --run` - Run tests once (no watch mode)
- `pnpm test -- src/queue.test.ts` - Run single test file
- `pnpm lint` - Check code with Biome linter
- `pnpm lint:fix` - Auto-fix linting issues
- `pnpm format` - Check formatting with Biome
- `pnpm format:fix` - Auto-fix formatting issues

## Code Style
- Use Biome for formatting/linting (2-space indentation, double quotes)
- TypeScript with strict typing, export types explicitly
- Import organization: node modules first, then relative imports
- Use `async/await` over promises, prefer `const` over `let`
- Class methods use camelCase, interfaces use PascalCase
- Error handling with try/catch blocks, avoid non-null assertions sparingly
- Use Drizzle ORM patterns for database operations
- Keep functions focused and well-documented with JSDoc comments