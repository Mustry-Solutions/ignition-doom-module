import { ComponentMeta, ComponentRegistry } from '@inductiveautomation/perspective-client';
import { Doom, DoomMeta } from './components/doom/Doom';

import './scss/doom.scss';

export { Doom };

const components: Array<ComponentMeta> = [new DoomMeta()];
components.forEach((c: ComponentMeta) => ComponentRegistry.register(c));
