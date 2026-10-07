// Add the maemo-react elements to React's JSX.
import type { MaemoIntrinsicElements } from './generated/intrinsics.js';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends MaemoIntrinsicElements {}
  }
}
