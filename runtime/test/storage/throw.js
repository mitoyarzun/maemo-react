// storage.sh: set an item, then throw at top level. The host still writes the file.
localStorage.setItem('token', 'secret');
localStorage.setItem('count', '1');
throw new Error('expected');
