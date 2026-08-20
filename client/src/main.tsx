/**
 * Entry point. The page HTML is already prerendered, so booting is purely
 * additive — no framework mount, no re-render, no flash of empty content.
 */
import { initApp } from './App.tsx';

void initApp();
