// The boca theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in boca.settings.json and the generated boca.settings.ts;
// change them with `astryx experimental theme editor set boca ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {bocaSettings} from './boca.settings';

export const bocaTheme = defineTheme({
  extends: bocaSettings,
  name: 'boca',
});
