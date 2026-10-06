import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// The whole suite runs in parallel; give screens time to appear when the machine is busy.
configure({ asyncUtilTimeout: 5000 });
