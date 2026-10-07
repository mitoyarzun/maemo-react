// storage.sh, run 1: write two items. The host writes the file at exit.
import { quit } from 'maemo:app';

localStorage.setItem('token', 'secret');
localStorage.setItem('count', '1');
console.log('written');
quit(0);
