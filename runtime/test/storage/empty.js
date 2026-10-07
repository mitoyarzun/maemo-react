// storage.sh, run 3: the file is corrupt, so the storage starts empty.
import { quit } from 'maemo:app';

if (localStorage.length !== 0) {
  console.log('expected an empty storage, got ' + localStorage.length + ' items');
  quit(1);
}
localStorage.setItem('token', 'secret');
localStorage.setItem('count', '1');
quit(0);
