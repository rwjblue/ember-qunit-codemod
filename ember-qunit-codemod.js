module.exports = function(file, api, options) {
  const j = api.jscodeshift;
  const root = j(file.source);

  function ensureImportWithSpecifiers({ source, specifiers, anchor, positionMethod }) {
    let importStatement = ensureImport(source, anchor, positionMethod);
    let combinedSpecifiers = new Set(specifiers);

    importStatement
      .find(j.ImportSpecifier)
      .forEach(i => combinedSpecifiers.add(i.node.imported.name))
      .remove();

    importStatement.get('specifiers').replace(
      Array.from(combinedSpecifiers)
        .sort()
        .map(s => j.importSpecifier(j.identifier(s)))
    );
  }

  function ensureImport(source, anchor, method = 'insertAfter') {
    let desiredImport = root.find(j.ImportDeclaration, { source: { value: source } });
    if (desiredImport.size() > 0) {
      return desiredImport;
    }

    let newImport = j.importDeclaration([], j.literal(source));
    let anchorImport = root.find(j.ImportDeclaration, { source: { value: anchor } });
    let imports = root.find(j.ImportDeclaration);
    if (anchorImport.size() > 0) {
      anchorImport[method](newImport);
    } else if (imports.size() > 0) {
      // if anchor is not present, always add at the end
      imports.insertAfter(newImport);
    } else {
      // if no imports are present, add as first statement
      root.get().node.program.body.unshift(newImport);
    }

    return j(newImport);
  }

  function moveQUnitImportsFromEmberQUnit() {
    let emberQUnitImports = root.find(j.ImportDeclaration, { source: { value: 'ember-qunit' } });
    // Find `module` and `test` imports
    let migrateToQUnitImport = ['module', 'test', 'skip', 'todo'];

    let specifiers = new Set();
    // Replace old with new test helpers imports
    emberQUnitImports
      .find(j.ImportSpecifier)
      .filter(p => migrateToQUnitImport.includes(p.node.imported.name))
      .forEach(p => specifiers.add(p.node.imported.name))
      .remove();

    if (specifiers.size === 0) {
      return;
    }

    ensureImportWithSpecifiers({
      source: 'qunit',
      anchor: 'ember-qunit',
      positionMethod: 'insertBefore',
      specifiers,
    });
  }

  function updateToNewEmberQUnitImports() {
    let mapping = {
      moduleFor: 'setupTest',
      moduleForComponent: 'setupRenderingTest',
      moduleForModel: 'setupTest',
    };

    let emberQUnitImports = root.find(j.ImportDeclaration, { source: { value: 'ember-qunit' } });

    // Collect all imports from ember-qunit into local array
    let emberQUnitSpecifiers = new Set();

    emberQUnitImports
      .find(j.ImportSpecifier)
      .forEach(p => {
        // Map them to the new imports
        let importName = p.node.imported.name;
        let mappedName = mapping[importName] || importName;

        if (mappedName !== importName) {
          ensureImportWithSpecifiers({
            source: 'qunit',
            anchor: 'ember-qunit',
            positionMethod: 'insertBefore',
            specifiers: ['module'],
          });
        }

        // If importName is `moduleForComponent` determine if we need
        // `setupTest` (unit) or `setupRenderingTest` (integration)
        if (importName === 'moduleForComponent') {
          root
            .find(j.ExpressionStatement, {
              expression: {
                callee: { name: 'moduleForComponent' },
              },
            })
            .forEach(p => {
              let [, , setupType] = parseModule(p);
              emberQUnitSpecifiers.add(setupType);
            });
        } else {
          emberQUnitSpecifiers.add(mappedName);
        }
      })
      // Remove all existing import specifiers
      .remove();

    emberQUnitImports
      .get('specifiers')
      .replace(Array.from(emberQUnitSpecifiers).map(s => j.importSpecifier(j.identifier(s))));
  }

  function updateEmberTestHelperImports() {
    let specifiers = new Set();

    let programPath = root.get('program');
    let bodyPath = programPath.get('body');
    bodyPath.each(expressionPath => {
      let expression = expressionPath.node;
      let isTest = j.match(expression, { expression: { callee: { name: 'test' } } });
      if (isTest) {
        ['render', 'clearRender'].forEach(type => {
          let usages = findTestHelperUsageOf(j(expression), type);
          if (usages.size() > 0) {
            specifiers.add(type);
          }
        });
      }
    });

    if (specifiers.size > 0) {
      ensureImportWithSpecifiers({
        source: 'ember-test-helpers',
        anchor: 'ember-qunit',
        specifiers,
      });
    }
  }

  function findTestHelperUsageOf(collection, property) {
    return collection.find(j.ExpressionStatement, {
      expression: {
        callee: {
          object: {
            type: 'ThisExpression',
          },
          property: {
            name: property,
          },
        },
      },
    });
  }

  function parseModule(p) {
    let calleeName = p.node.expression.callee.name;
    // Find the moduleName and the module's options
    let moduleName, subject, options, hasCustomSubject;
    let calleeArguments = p.node.expression.arguments.slice();
    let lastArgument = calleeArguments[calleeArguments.length - 1];
    if (lastArgument.type === 'ObjectExpression') {
      options = calleeArguments.pop();
    }
    moduleName = calleeArguments[1] || calleeArguments[0];
    subject = calleeArguments[0];

    let setupIdentifier = 'setupTest';
    if (options) {
      let hasIntegration = options.properties.some(p => p.key.name === 'integration');

      if (calleeName === `moduleForComponent`) {
        if (hasIntegration) {
          setupIdentifier = 'setupRenderingTest';
          subject = null;
        } else {
          subject = j.literal(`component:${calleeArguments[0].value}`);
        }
      } else if (calleeName === 'moduleForModel') {
        subject = j.literal(`model:${calleeArguments[0].value}`);
      }

      hasCustomSubject = options.properties.some(p => p.key.name === 'subject');
    }

    return [moduleName, options, setupIdentifier, subject, hasCustomSubject];
  }

  function updateModuleForToNestedModule() {
    const POSSIBLE_MODULES = [
      { expression: { callee: { name: 'moduleFor' } } },
      { expression: { callee: { name: 'moduleForComponent' } } },
      { expression: { callee: { name: 'moduleForModel' } } },
    ];

    function isModuleDefinition(nodePath) {
      return POSSIBLE_MODULES.some(matcher => j.match(nodePath, matcher));
    }

    const LIFE_CYCLE_METHODS = [
      { key: { name: 'before' }, value: { type: 'FunctionExpression' } },
      { key: { name: 'beforeEach' }, value: { type: 'FunctionExpression' } },
      { key: { name: 'afterEach' }, value: { type: 'FunctionExpression' } },
      { key: { name: 'after' }, value: { type: 'FunctionExpression' } },
    ];

    function isLifecycleHook(nodePath) {
      return LIFE_CYCLE_METHODS.some(matcher => j.match(nodePath, matcher));
    }

    function createModule(p) {
      let [moduleName, options, setupType, subject, hasCustomSubject] = parseModule(p);

      // Create the new `module(moduleName, function(hooks) {});` invocation
      let callback = j.functionExpression(
        null /* no function name */,
        [j.identifier('hooks')],
        j.blockStatement([
          j.expressionStatement(j.callExpression(j.identifier(setupType), [j.identifier('hooks')])),
        ])
      );
      let moduleInvocation = j.expressionStatement(
        j.callExpression(j.identifier('module'), [moduleName, callback])
      );

      if (options) {
        let customMethodBeforeEachBody, customMethodBeforeEachExpression;

        options.properties.forEach(property => {
          updateGetOwnerThisUsage(property.value);

          if (isLifecycleHook(property)) {
            let lifecycleStatement = j.expressionStatement(
              j.callExpression(j.memberExpression(j.identifier('hooks'), property.key), [
                property.value,
              ])
            );

            // preserve any comments that were present
            lifecycleStatement.comments = property.comments;

            callback.body.body.push(lifecycleStatement);
          } else {
            const IGNORED_PROPERTIES = ['integration', 'needs', 'unit'];
            if (IGNORED_PROPERTIES.includes(property.key.name)) {
              return;
            }

            if (!customMethodBeforeEachBody) {
              customMethodBeforeEachBody = j.blockStatement([]);
              customMethodBeforeEachExpression = j.expressionStatement(
                j.callExpression(
                  j.memberExpression(j.identifier('hooks'), j.identifier('beforeEach')),
                  [
                    j.functionExpression(
                      null,
                      [
                        /* no arguments */
                      ],
                      customMethodBeforeEachBody
                    ),
                  ]
                )
              );

              callback.body.body.push(customMethodBeforeEachExpression);
            }

            let methodAssignment = j.expressionStatement(
              j.assignmentExpression(
                '=',
                j.memberExpression(j.thisExpression(), property.key),
                property.value
              )
            );

            // preserve any comments that were present
            methodAssignment.comments = property.comments;

            customMethodBeforeEachBody.body.push(methodAssignment);
          }
        });

        if (setupType === 'setupRenderingTest') {
          processExpressionForRenderingTest(callback);
        } else {
          processSubject(callback, subject);
        }
      }

      return [moduleInvocation, callback.body.body, setupType, subject, hasCustomSubject];
    }

    function processExpressionForRenderingTest(testExpression) {
      // mark the test function as an async function
      let testExpressionCollection = j(testExpression);

      // Transform to await render() or await clearRender()
      ['render', 'clearRender'].forEach(type => {
        findTestHelperUsageOf(testExpressionCollection, type).forEach(p => {
          let expression = p.get('expression');

          let awaitExpression = j.awaitExpression(
            j.callExpression(j.identifier(type), expression.node.arguments)
          );
          expression.replace(awaitExpression);
          p.scope.node.async = true;
        });
      });

      // Migrate `this._element` -> `this.element`
      testExpressionCollection
        .find(j.MemberExpression, {
          object: {
            type: 'ThisExpression',
          },
          property: {
            name: '_element',
          },
        })
        .forEach(p => {
          let property = p.get('property');
          property.node.name = 'element';
        });
    }

    function processSubject(testExpression, subject) {
      let thisDotSubjectUsage = j(testExpression).find(j.CallExpression, {
        callee: {
          type: 'MemberExpression',
          object: {
            type: 'ThisExpression',
          },
          property: {
            name: 'subject',
          },
        },
      });

      if (thisDotSubjectUsage.size() === 0) {
        return;
      }

      thisDotSubjectUsage.forEach(p => {
        let options = p.node.arguments[0];
        let [subjectType, subjectName] = subject.value.split(':');
        let isSingletonSubject = !['model', 'component'].includes(subjectType);

        // if we don't have `options` and the type is a singleton type
        // use `this.owner.lookup(subject)`
        if (!options && isSingletonSubject) {
          p.replace(
            j.callExpression(
              j.memberExpression(
                j.memberExpression(j.thisExpression(), j.identifier('owner')),
                j.identifier('lookup')
              ),
              [subject]
            )
          );
        } else if (subjectType === 'model') {
          p.replace(
            j.callExpression(
              j.memberExpression(
                j.callExpression(
                  j.memberExpression(
                    j.memberExpression(j.thisExpression(), j.identifier('owner')),
                    j.identifier('lookup')
                  ),
                  [j.literal('service:store')]
                ),
                j.identifier('createRecord')
              ),
              [j.literal(subjectName), options].filter(Boolean)
            )
          );
        } else {
          p.replace(
            j.callExpression(
              j.memberExpression(
                j.callExpression(
                  j.memberExpression(
                    j.memberExpression(j.thisExpression(), j.identifier('owner')),
                    j.identifier('factoryFor')
                  ),
                  [subject]
                ),
                j.identifier('create')
              ),
              [options].filter(Boolean)
            )
          );
        }
      });
    }

    let programPath = root.get('program');
    let bodyPath = programPath.get('body');

    let bodyReplacement = [];
    let currentModuleCallbackBody, currentTestType, currentSubject, currentHasCustomSubject;
    bodyPath.each(expressionPath => {
      let expression = expressionPath.node;
      if (isModuleDefinition(expressionPath)) {
        let result = createModule(expressionPath);
        bodyReplacement.push(result[0]);
        currentModuleCallbackBody = result[1];
        currentTestType = result[2];
        currentSubject = result[3];
        currentHasCustomSubject = result[4];
      } else if (currentModuleCallbackBody) {
        currentModuleCallbackBody.push(expression);

        let isTest = j.match(expression, { expression: { callee: { name: 'test' } } });
        if (isTest) {
          updateGetOwnerThisUsage(expression.expression.arguments[1]);
          if (currentTestType === 'setupRenderingTest') {
            processExpressionForRenderingTest(expression);
          } else if (currentTestType === 'setupTest' && !currentHasCustomSubject) {
            processSubject(expression, currentSubject);
          }
        }
      } else {
        bodyReplacement.push(expression);
      }
    });

    bodyPath.replace(bodyReplacement);
  }

  function updateLookupCalls() {
    root
      .find(j.MemberExpression, {
        object: {
          object: { type: 'ThisExpression' },
          property: { name: 'container' },
        },
        property: { name: 'lookup' },
      })
      .forEach(path => {
        let thisDotOwner = j.memberExpression(j.thisExpression(), j.identifier('owner'));
        path.replace(j.memberExpression(thisDotOwner, path.value.property));
      });
  }

  function updateRegisterCalls() {
    root
      .find(j.MemberExpression, {
        object: {
          object: { type: 'ThisExpression' },
          property: { name: 'registry' },
        },
        property: { name: 'register' },
      })
      .forEach(path => {
        let thisDotOwner = j.memberExpression(j.thisExpression(), j.identifier('owner'));
        path.replace(j.memberExpression(thisDotOwner, path.value.property));
      });

    root
      .find(j.MemberExpression, {
        object: { type: 'ThisExpression' },
        property: { name: 'register' },
      })
      .forEach(path => {
        let thisDotOwner = j.memberExpression(j.thisExpression(), j.identifier('owner'));
        path.replace(j.memberExpression(thisDotOwner, path.value.property));
      });
  }

  function updateInjectCalls() {
    root
      .find(j.CallExpression, {
        callee: {
          type: 'MemberExpression',
          object: {
            object: {
              type: 'ThisExpression',
            },
            property: {
              name: 'inject',
            },
          },
        },
      })
      .forEach(p => {
        let injectType = p.node.callee.property.name;
        let injectedName = p.node.arguments[0].value;
        let localName = injectedName;
        if (p.node.arguments[1]) {
          let options = p.node.arguments[1];
          let as = options.properties.find(property => property.key.name === 'as');
          if (as) {
            localName = as.value.value;
          }
        }
        let property = j.identifier(localName);
        // rudimentary attempt to confirm the property name is valid
        // as `this.propertyName`
        if (!localName.match(/^[a-zA-Z_][a-zA-Z0-9]+$/)) {
          // if not, use `this['property-name']`
          property = j.literal(localName);
        }
        let assignment = j.assignmentExpression(
          '=',
          j.memberExpression(j.thisExpression(), property),
          j.callExpression(
            j.memberExpression(
              j.memberExpression(j.thisExpression(), j.identifier('owner')),
              j.identifier('lookup')
            ),
            [j.literal(`${injectType}:${injectedName}`)]
          )
        );

        p.replace(assignment);
      });
  }

  function updateGetOwnerThisUsage(expression) {
    let expressionCollection = j(expression);
    let thisDotOwner = j.memberExpression(j.thisExpression(), j.identifier('owner'));

    function replacement(path) {
      if (path.scope.node === expression) {
        path.replace(thisDotOwner);
      }
    }

    expressionCollection
      .find(j.CallExpression, {
        callee: {
          name: 'getOwner',
        },
      })
      .forEach(replacement);

    expressionCollection
      .find(j.CallExpression, {
        callee: {
          type: 'MemberExpression',
          object: {
            name: 'Ember',
          },
          property: {
            name: 'getOwner',
          },
        },
      })
      .forEach(replacement);
  }

  function updateWaitUsage() {
    let waitImport = root.find(j.ImportDeclaration, {
      source: { value: 'ember-test-helpers/wait' },
    });

    if (waitImport.size() > 0) {
      let importedName;

      ensureImportWithSpecifiers({
        source: 'ember-test-helpers',
        anchor: 'ember-qunit',
        specifiers: ['settled'],
      });

      waitImport.find(j.ImportDefaultSpecifier).forEach(p => (importedName = p.node.local.name));
      waitImport.remove();

      root.find(j.CallExpression, { callee: { name: importedName } }).forEach(p => {
        p.node.callee.name = 'settled';
      });
    }
  }

  const printOptions = options.printOptions || { quote: 'single' };

  let emberQUnitImports = root.find(j.ImportDeclaration, { source: { value: 'ember-qunit' } });
  if (emberQUnitImports.size() > 0) {
    moveQUnitImportsFromEmberQUnit();
    updateToNewEmberQUnitImports();
    updateEmberTestHelperImports();
    updateModuleForToNestedModule();
    updateLookupCalls();
    updateRegisterCalls();
    updateInjectCalls();
  } else {
    updateEmberTestHelperImports();
  }

  updateWaitUsage();

  return root.toSource(printOptions);
};
