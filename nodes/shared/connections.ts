import { NodeConnectionTypes, type NodeConnectionType } from 'n8n-workflow';

/**
 * n8n-workflow releases before 2.0 do not export `NodeConnectionTypes`. Such a
 * copy can end up hoisted in ~/.n8n/nodes by other community packages (the
 * verification ruleset mandates a `*` peer range, so npm reuses whatever copy
 * satisfies it), and referencing the missing export while n8n instantiates the
 * node class makes the whole package fail to install with "Class could not be
 * found". Falling back to the literal keeps the nodes loadable there.
 */
export const MAIN_CONNECTION: NodeConnectionType =
	(NodeConnectionTypes as typeof NodeConnectionTypes | undefined)?.Main ?? 'main';
