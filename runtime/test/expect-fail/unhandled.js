// expect: Unhandled promise rejection: Error: nobody catches this
Promise.reject(new Error('nobody catches this'));
