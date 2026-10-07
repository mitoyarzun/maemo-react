// The files of a new application.

/** The folders of the maemo-react packages, by package name. */
export type PackageFolders = Record<'core' | 'widgets' | 'cli' | 'types', string>;

export function templateFiles(id: string, name: string, pkg: PackageFolders): Record<string, string> {
  return {
    'app.json': JSON.stringify({ id, name, version: '0.1.0', description: `${name}, made with maemo-react` }, null, 2) + '\n',
    'package.json':
      JSON.stringify(
        {
          name: id,
          version: '0.1.0',
          private: true,
          type: 'module',
          scripts: {
            build: 'maemo-react build',
            package: 'maemo-react package',
            deploy: 'maemo-react deploy',
            typecheck: 'tsc',
          },
          dependencies: {
            '@maemo-react/core': `file:${pkg.core}`,
            '@maemo-react/widgets': `file:${pkg.widgets}`,
            react: '19.3.0',
          },
          devDependencies: {
            '@maemo-react/cli': `file:${pkg.cli}`,
            '@maemo-react/types': `file:${pkg.types}`,
            '@types/react': '19.3.0',
            typescript: '5.9.3',
          },
        },
        null,
        2,
      ) + '\n',
    'tsconfig.json':
      JSON.stringify(
        {
          compilerOptions: {
            target: 'es2020',
            module: 'esnext',
            moduleResolution: 'bundler',
            jsx: 'react-jsx',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            lib: ['es2023'],
            types: ['@maemo-react/types'],
            // The linked packages must see the React types of the application.
            paths: {
              react: ['./node_modules/@types/react'],
              'react/*': ['./node_modules/@types/react/*'],
            },
          },
          include: ['src'],
        },
        null,
        2,
      ) + '\n',
    'src/main.tsx': `import { render } from '@maemo-react/core';
import { App } from './App.js';

render(<App />);
`,
    'src/App.tsx': `import { useState } from 'react';
import { Box, Button, Label, Window } from '@maemo-react/widgets';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <Window title={${JSON.stringify(name)}}>
      <Box vertical spacing={8}>
        <Label>{${JSON.stringify('Hello from ' + name + '!')}}</Label>
        <Label>{'Clicks: ' + count}</Label>
        <Button onClick={() => setCount(count + 1)}>Click me</Button>
      </Box>
    </Window>
  );
}
`,
  };
}
