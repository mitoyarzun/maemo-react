// storage.sh: with MR_APP_ID=../x the id must be a safe folder name.
import { dataDir, id, quit } from 'maemo:app';

if (id.includes('/') || id === '..' || id === '.' || id === '' || id === '../x' || dataDir.includes('..')) {
  console.log('unsafe id ' + id + ', ' + dataDir);
  quit(1);
}
console.log('id ' + id);
quit(0);
