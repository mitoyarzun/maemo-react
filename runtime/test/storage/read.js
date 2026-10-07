// storage.sh, runs 2 and 4: the items of write.js are there.
import { quit } from 'maemo:app';

if (localStorage.getItem('token') !== 'secret' || localStorage.length !== 2) {
  console.log('read: wrong contents, length ' + localStorage.length);
  quit(1);
} else {
  console.log('read ok');
  quit(0);
}
