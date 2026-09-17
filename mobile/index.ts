import { registerRootComponent } from 'expo';
import App from './App';
// Background task definitions must be registered at module load, before any UI mounts.
import './src/trips/background-task';

registerRootComponent(App);
