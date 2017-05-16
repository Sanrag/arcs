# arcs

## Install

Note that you need a **recent** version of Node because we use new ES6 features. v7.8.0 is definitely OK - earlier v7 versions are probably fine too. 

```
$ (cd runtime && npm install)
$ (cd tracelib && npm install)
```

## Test
```
$ (cd runtime && gulp)
```

If there are unhandled promise exceptions without stack traces, use `./node_modules/.bin/mocha --trace-warnings`.

## Trace
```
$ cd runtime
$ traceFile=`pwd`/trace.json npm test
```
