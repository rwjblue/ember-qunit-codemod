module.exports = function(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);

  const POSSIBLE_MODULES = [
    { expression: { callee: { name: 'module' } } },
    { expression: { callee: { name: 'moduleFor' } } },
    { expression: { callee: { name: 'moduleForComponent' } } },
    { expression: { callee: { name: 'moduleForModel' } } },
  ];

  class ModuleInfo {
    static isModuleDefinition(nodePath) {
      return POSSIBLE_MODULES.some(matcher => j.match(nodePath, matcher));
    }

    constructor(p) {
      let calleeName = p.node.expression.callee.name;
      // Find the moduleName and the module's options
      let moduleName, subject, options, hasCustomSubject, isNestedModule;
      let calleeArguments = p.node.expression.arguments.slice();
      let lastArgument = calleeArguments[calleeArguments.length - 1];
      if (lastArgument.type === 'ObjectExpression') {
        options = calleeArguments.pop();
      }
      if (calleeArguments[1] && j.match(calleeArguments[1], { type: 'FunctionExpression' })) {
        isNestedModule = true;
        moduleName = calleeArguments[0];
      } else {
        moduleName = calleeArguments[1] || calleeArguments[0];
        subject = calleeArguments[0];
      }

      let setupIdentifier = calleeName === 'module' ? null : 'setupTest';

      if (calleeName === `moduleForComponent`) {
        let hasUnitOrNeeds =
          options && options.properties.some(p => p.key.name === 'unit' || p.key.name === 'needs');

        if (!hasUnitOrNeeds) {
          setupIdentifier = 'setupRenderingTest';
          subject = null;
        } else {
          subject = j.literal(`component:${calleeArguments[0].value}`);
        }
      } else if (calleeName === 'moduleForModel') {
        subject = j.literal(`model:${calleeArguments[0].value}`);
      }

      if (options) {
        hasCustomSubject = options.properties.some(p => p.key.name === 'subject');
      }

      this.moduleName = moduleName;
      this.moduleOptions = options;
      this.setupType = setupIdentifier;
      this.subjectContainerKey = subject;
      this.hasCustomSubjectImplementation = hasCustomSubject;
      this.isNestedModule = isNestedModule;

      this.moduleInvocation = null;
      this.moduleCallbackBody = null;
    }
  }

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
      anchorImport.at(anchorImport.size() - 1)[method](newImport);
    } else if (imports.size() > 0) {
      // if anchor is not present, always add at the end
      imports.at(imports.size() - 1).insertAfter(newImport);
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
    if (emberQUnitImports.size() === 0) {
      return;
    }

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
              let moduleInfo = new ModuleInfo(p);
              emberQUnitSpecifiers.add(moduleInfo.setupType);
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

    // If we have an empty import, remove the import declaration
    if (emberQUnitSpecifiers.size === 0) {
      emberQUnitImports.remove();
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

  function addHooksParam(moduleInfo) {
    moduleInfo.moduleCallback.params = [j.identifier('hooks')];
  }

  function addToBeforeEach(moduleInfo, expression) {
    let beforeEachBody = moduleInfo.moduleBeforeEachBody;
    if (!beforeEachBody) {
      if (moduleInfo.moduleCallback) {
        addHooksParam(moduleInfo);
      }

      let beforeEachBlockStatement = j.blockStatement([]);
      let beforeEachExpression = j.expressionStatement(
        j.callExpression(j.memberExpression(j.identifier('hooks'), j.identifier('beforeEach')), [
          j.functionExpression(
            null,
            [
              /* no arguments */
            ],
            beforeEachBlockStatement
          ),
        ])
      );

      beforeEachBody = moduleInfo.moduleBeforeEachBody = beforeEachBlockStatement.body;
      let insertAt = moduleInfo.setupType ? 1 : 0;
      moduleInfo.moduleCallbackBody.splice(insertAt, 0, beforeEachExpression);
    }

    beforeEachBody.push(expression);
  }

  function updateModuleForToNestedModule() {
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
      let moduleInfo = new ModuleInfo(p);

      if (moduleInfo.isNestedModule) {
        return null;
      }

      let needsHooks = false;
      let moduleSetupExpression;
      if (moduleInfo.setupType) {
        needsHooks = true;
        moduleSetupExpression = j.expressionStatement(
          j.callExpression(j.identifier(moduleInfo.setupType), [j.identifier('hooks')])
        );
        moduleInfo.moduleSetupExpression = moduleSetupExpression;
      }

      // Create the new `module(moduleName, function(hooks) {});` invocation
      let callback = j.functionExpression(
        null /* no function name */,
        [],
        j.blockStatement([moduleSetupExpression].filter(Boolean))
      );
      moduleInfo.moduleCallbackBody = callback.body.body;
      moduleInfo.moduleCallback = callback;

      function buildModule(moduleName, callback) {
        // using j.callExpression() builds this:

        // module(
        //   'some loooooooooooong name',
        //   function(hooks) {
        //     setupTest(hooks);
        //   }
        // );

        // but we want to enforce not having line breaks in the module() invocation
        // so we'll have to use a little hack to get this:

        // module('some loooooooooooong name', function(hooks) {
        //   setupTest(hooks);
        // });

        let node = j(`module('moduleName', function(hooks) {})`)
          .find(j.CallExpression)
          .paths()[0].node;

        node.arguments[0] = moduleName;
        node.arguments[1] = callback;

        return node;
      }

      let moduleInvocation = j.expressionStatement(buildModule(moduleInfo.moduleName, callback));

      if (moduleInfo.moduleOptions) {
        moduleInfo.moduleOptions.properties.forEach(property => {
          if (moduleInfo.setupType) {
            let expressionCollection = j(property.value);

            updateGetOwnerThisUsage(expressionCollection);
            updateLookupCalls(expressionCollection);
            updateRegisterCalls(expressionCollection);
            updateInjectCalls(expressionCollection);
            updateOnCalls(expressionCollection, moduleInfo);

            if (j.match(property, { key: { name: 'resolver' } })) {
              let setupExpression = moduleInfo.moduleSetupExpression;
              setupExpression.expression.arguments.push(j.objectExpression([property]));
              return;
            }
          }

          if (isLifecycleHook(property)) {
            needsHooks = true;
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

            let methodAssignment = j.expressionStatement(
              j.assignmentExpression(
                '=',
                j.memberExpression(j.thisExpression(), property.key),
                property.value
              )
            );

            // preserve any comments that were present
            methodAssignment.comments = property.comments;

            addToBeforeEach(moduleInfo, methodAssignment);
          }
        });

        if (moduleInfo.setupType === 'setupRenderingTest') {
          processExpressionForRenderingTest(callback);
        } else {
          processSubject(callback, moduleInfo.subjectContainerKey);
        }
      }

      moduleInfo.moduleInvocation = moduleInvocation;

      if (needsHooks === true) {
        addHooksParam(moduleInfo);
      }

      return moduleInfo;
    }

    function processExpressionForRenderingTest(testExpression) {
      // mark the test function as an async function
      let testExpressionCollection = j(testExpression);
      let specifiers = new Set();

      // Transform to await render() or await clearRender()
      ['render', 'clearRender'].forEach(type => {
        findTestHelperUsageOf(testExpressionCollection, type).forEach(p => {
          specifiers.add(type);

          let expression = p.get('expression');

          let awaitExpression = j.awaitExpression(
            j.callExpression(j.identifier(type), expression.node.arguments)
          );
          expression.replace(awaitExpression);
          p.scope.node.async = true;
        });
      });

      ensureImportWithSpecifiers({
        source: 'ember-test-helpers',
        anchor: 'ember-qunit',
        specifiers,
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
          ensureImportWithSpecifiers({
            source: '@ember/runloop',
            specifiers: ['run'],
          });

          p.replace(
            j.callExpression(j.identifier('run'), [
              j.arrowFunctionExpression(
                [],
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
                ),
                true
              ),
            ])
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

    let currentModuleInfo;
    bodyPath.each(expressionPath => {
      let expression = expressionPath.node;
      if (ModuleInfo.isModuleDefinition(expressionPath)) {
        let moduleInfo = createModule(expressionPath);
        if (moduleInfo === null) {
          return;
        }
        currentModuleInfo = moduleInfo;
        expressionPath.replace(moduleInfo.moduleInvocation);
      } else if (currentModuleInfo) {
        // calling `path.replace()` essentially just removes
        expressionPath.replace();
        currentModuleInfo.moduleCallbackBody.push(expression);

        let isTest = j.match(expression, { expression: { callee: { name: 'test' } } });
        if (isTest) {
          let expressionCollection = j(expression);
          updateLookupCalls(expressionCollection);
          updateRegisterCalls(expressionCollection);
          updateInjectCalls(expressionCollection);
          updateOnCalls(expressionCollection, currentModuleInfo);
          // passing the specific function callback here, because `getOwner` is only
          // transformed if the call site's scope is the same as the expression passed
          updateGetOwnerThisUsage(j(expression.expression.arguments[1]));

          if (currentModuleInfo.setupType === 'setupRenderingTest') {
            processExpressionForRenderingTest(expression);
          } else if (
            currentModuleInfo.setupType === 'setupTest' &&
            !currentModuleInfo.hasCustomSubjectImplementation
          ) {
            processSubject(expression, currentModuleInfo.subjectContainerKey);
          }
        }
      }
    });
  }

  function updateLookupCalls(ctx) {
    ctx
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

  function updateRegisterCalls(ctx) {
    ctx
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

    ctx
      .find(j.MemberExpression, {
        object: { type: 'ThisExpression' },
        property: { name: 'register' },
      })
      .forEach(path => {
        let thisDotOwner = j.memberExpression(j.thisExpression(), j.identifier('owner'));
        path.replace(j.memberExpression(thisDotOwner, path.value.property));
      });
  }

  function updateOnCalls(ctx, moduleInfo) {
    let usages = ctx.find(j.CallExpression, {
      callee: {
        type: 'MemberExpression',
        object: {
          type: 'ThisExpression',
        },
        property: {
          name: 'on',
        },
      },
    });

    usages.forEach(p => {
      let actionName = p.node.arguments[0].value;
      let property = j.identifier(actionName);

      if (!actionName.match(/^[a-zA-Z_][a-zA-Z0-9]+$/)) {
        // if not, use `this['property-name']`
        property = j.literal(actionName);
      }

      let assignment = j.assignmentExpression(
        '=',
        j.memberExpression(
          j.memberExpression(j.thisExpression(), j.identifier('actions')),
          property
        ),
        p.node.arguments[1]
      );
      p.replace(assignment);
    });

    if (usages.size() > 0 && !moduleInfo.hasSendFunctionInBeforeEach) {
      moduleInfo.hasSendFunctionInBeforeEach = true;

      addToBeforeEach(
        moduleInfo,
        j.expressionStatement(
          j.assignmentExpression(
            '=',
            j.memberExpression(j.thisExpression(), j.identifier('actions')),
            j.objectExpression([])
          )
        )
      );

      addToBeforeEach(
        moduleInfo,
        j.expressionStatement(
          j.assignmentExpression(
            '=',
            j.memberExpression(j.thisExpression(), j.identifier('send')),
            j.arrowFunctionExpression(
              [j.identifier('actionName'), j.restElement(j.identifier('args'))],
              j.callExpression(
                j.memberExpression(
                  j.memberExpression(
                    j.memberExpression(j.thisExpression(), j.identifier('actions')),
                    j.identifier('actionName'),
                    true
                  ),
                  j.identifier('apply')
                ),
                [j.thisExpression(), j.identifier('args')]
              )
            )
          )
        )
      );
    }
  }

  function updateInjectCalls(ctx) {
    ctx
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

  function updateGetOwnerThisUsage(expressionCollection) {
    let expression = expressionCollection.get().node;
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

  const printOptions = { quote: 'single', wrapColumn: 100 };

  moveQUnitImportsFromEmberQUnit();
  updateToNewEmberQUnitImports();
  updateModuleForToNestedModule();
  updateWaitUsage();

  return root.toSource(printOptions);
};
