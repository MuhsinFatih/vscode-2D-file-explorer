// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
// import DOMPurify from 'dompurify';
const MAX_FILES_IN_FOLDER = 50;
const IGNORE = ['node_modules', '.git', '.vscode', '.github'];
class FileNode {
	constructor(public name: string, public children: FileNode[] = []) {}
}

function getFilesRecursively(root: string) {
	const files: FileNode[] = [];
	for (const file of fs.readdirSync(root, { withFileTypes: true})) {
		if (file.isDirectory()) {
			const nFiles = fs.readdirSync(`${root}/${file.name}`, { withFileTypes: false }).length;
			if (nFiles > MAX_FILES_IN_FOLDER || IGNORE.includes(file.name)) {
				files.push(new FileNode(file.name, [new FileNode(`(${nFiles} files)`, [])]));
			} else {
				files.push(new FileNode(file.name, getFilesRecursively(`${root}/${file.name}`)));
			}
		} else {
			files.push(new FileNode(file.name));
		}
	}
	return files;
}

function getTree(root: FileNode, indent = 0) {
	let result = '';
	for (const child of root.children) {
		result += ' '.repeat(indent) + child.name + '\n';
		if (child.children.length) {
			result += getTree(child, indent + 2);
		}
	}
	return result;
}

function toD3input(root: FileNode, parent?: string): Record<"id", string>[] {
	const result: Record<"id", string>[] = [];
	if (root.children.length) {
		for (const child of root.children) {
			// const sanitizedName = DOMPurify.sanitize(child.name);
			const sanitizedName = child.name;
			result.push({"id": `${parent ? parent + '/' : ''}${sanitizedName}`});
			result.push(...toD3input(child, `${parent ? parent + '/' : ''}${sanitizedName}`));
		}
	}
	return result;
}


const cats = {
	'Coding Cat': 'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif',
	'Compiling Cat': 'https://media.giphy.com/media/mlvseq9yvZhba/giphy.gif',
	'Testing Cat': 'https://media.giphy.com/media/3oriO0OEd9QIDdllqo/giphy.gif'
};

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
	return {
		// Enable javascript in the webview
		enableScripts: true,

		// And restrict the webview to only loading content from our extension's `media` directory.
		localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
	};
}

/**
 * Manages cat coding webview panels
 */
class CatCodingPanel {
	/**
	 * Track the currently panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: CatCodingPanel | undefined;

	public static readonly viewType = 'catCoding';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(extensionUri: vscode.Uri) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, show it.
		if (CatCodingPanel.currentPanel) {
			CatCodingPanel.currentPanel._panel.reveal(column);
			return;
		}

		// Otherwise, create a new panel.
		const panel = vscode.window.createWebviewPanel(
			CatCodingPanel.viewType,
			'Cat Coding',
			column || vscode.ViewColumn.One,
			getWebviewOptions(extensionUri),
		);

		CatCodingPanel.currentPanel = new CatCodingPanel(panel, extensionUri);
	}

	public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		CatCodingPanel.currentPanel = new CatCodingPanel(panel, extensionUri);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this._panel = panel;
		this._extensionUri = extensionUri;

		// Set the webview's initial html content
		this._update();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programmatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Update the content based on view changes
		this._panel.onDidChangeViewState(
			() => {
				if (this._panel.visible) {
					this._update();
				}
			},
			null,
			this._disposables
		);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'alert':
						vscode.window.showErrorMessage(message.text);
						return;
				}
			},
			null,
			this._disposables
		);
	}

	public doRefactor() {
		// Send a message to the webview webview.
		// You can send any JSON serializable data.
		this._panel.webview.postMessage({ command: 'refactor' });
	}

	public dispose() {
		CatCodingPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private _update() {
		const webview = this._panel.webview;

		// Vary the webview's content based on where it is located in the editor.
		switch (this._panel.viewColumn) {
			case vscode.ViewColumn.Two:
				this._updateForCat(webview, 'Compiling Cat');
				return;

			case vscode.ViewColumn.Three:
				this._updateForCat(webview, 'Testing Cat');
				return;

			case vscode.ViewColumn.One:
			default:
				this._updateForCat(webview, 'Coding Cat');
				return;
		}
	}

	private async _updateForCat(webview: vscode.Webview, catName: keyof typeof cats) {
		this._panel.title = catName;
		const html = await this._getHtmlForWebview(webview, cats[catName]);
		if (html !== undefined) {
			this._panel.webview.html = html;
		}
	}

	private async _getHtmlForWebview(webview: vscode.Webview, catGifPath: string) {
		// Local path to main script run in the webview
		const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js');

		// And the uri we use to load this script in the webview
		const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

		// Local path to css styles
		const styleResetPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css');
		const stylesPathMainPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css');

		// Uri to load styles into webview
		const stylesResetUri = webview.asWebviewUri(styleResetPath);
		const stylesMainUri = webview.asWebviewUri(stylesPathMainPath);

		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();
		
	// 	return `<!DOCTYPE html>
	// 		<html lang="en">
	// 		<head>
	// 			<meta charset="UTF-8">

	// 			<!--
	// 				Use a content security policy to only allow loading images from https or from our extension directory,
	// 				and only allow scripts that have a specific nonce.
	// 			-->
	// 			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">

	// 			<meta name="viewport" content="width=device-width, initial-scale=1.0">

	// 			<link href="${stylesResetUri}" rel="stylesheet">
	// 			<link href="${stylesMainUri}" rel="stylesheet">

	// 			<title>Cat Coding</title>
	// 		</head>
	// 		<body>
	// 			<img src="${catGifPath}" width="300" />
	// 			<h1 id="lines-of-code-counter">0</h1>

	// 			<script nonce="${nonce}" src="${scriptUri}"></script>
	// 		</body>
	// 		</html>`;

		// get recursive file tree
		if (!vscode.workspace.workspaceFolders?.length) {
			vscode.window.showInformationMessage('No folder or workspace opened');
			return;
		}
		let rootPath;
		let rootName;
		if (vscode.workspace.workspaceFolders.length > 1) {
			const quickPickResult = vscode.window.showQuickPick(
				vscode.workspace.workspaceFolders.map((folder) => folder.name),
				{
				ignoreFocusOut: true,
				placeHolder: 'Workspace folder name',
				canPickMany: false,
				title: 'Select workspace folder'
			});
			const workspaceName = await quickPickResult;
			vscode.window.showInformationMessage(`you selected ${workspaceName}`);
			const workspaceFolder = vscode.workspace.workspaceFolders.find((folder) => folder.name === workspaceName);
			rootPath = workspaceFolder!.uri.fsPath;
			rootName = workspaceName;
		} else {
			rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
			rootName = vscode.workspace.workspaceFolders[0].name;
		}
		const root = new FileNode(rootPath, getFilesRecursively(rootPath));
		const d3input = [{"id": rootName}].concat(toD3input(root, rootName));
		console.log("d3input", d3input);
		const height = d3input.length * 20 + 400;
		const width = 5000;
		return `
			<!DOCTYPE html>
			<meta charset="utf-8">
			<style>

			.node circle {
				fill: #999;
			}

			.node text {
				font: 14px sans-serif;
				fill: white;
			}

			.node--internal circle {
				fill: #555;
			}

			.node--internal text {
				font-weight: bold;
			}

			.link {
				fill: none;
				stroke: #555;
				stroke-opacity: 0.4;
				stroke-width: 1.5px;
			}

			form {
				font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
				position: absolute;
				left: 10px;
				top: 10px;
			}

			label {
				display: block;
			}

			</style>
			<form>
				<label><input type="radio" name="mode" value="cluster" checked> Dendrogram</label>
				<label><input type="radio" name="mode" value="tree"> Tree</label>
			</form>
			<svg width="${width}" height="${height}"></svg>
			<script src="https://d3js.org/d3.v4.min.js"></script>
			<script>

			var svg = d3.select("svg"),
					width = +svg.attr("width"),
					height = +svg.attr("height"),
					g = svg.append("g").attr("transform", "translate(40,0)");

			var tree = d3.tree()
					.size([height - 400, width - 160]);

			var cluster = d3.cluster()
					.size([height, width - 160]);

			var stratify = d3.stratify()
					.parentId(function(d) { return d.id.substring(0, d.id.lastIndexOf("/")); });


				const data = JSON.parse('${JSON.stringify(d3input)}');

				var root = stratify(data)
						.sort(function(a, b) { return (a.height - b.height) || a.id.localeCompare(b.id); });

				cluster(root);

				var link = g.selectAll(".link")
						.data(root.descendants().slice(1))
					.enter().append("path")
						.attr("class", "link")
						.attr("d", diagonal);

				var node = g.selectAll(".node")
						.data(root.descendants())
					.enter().append("g")
						.attr("class", function(d) { return "node" + (d.children ? " node--internal" : " node--leaf"); })
						.attr("transform", function(d) { return "translate(" + d.y + "," + d.x + ")"; });

				node.append("circle")
						.attr("r", 5);

				// node.append("rect")
				// 		.attr("x", function(d) { return d.children ? -8 - 2 : 8 - 2; })
				// 		.attr("y", -10)
				// 		.attr("width", function(d) { return d.id.substring(d.id.lastIndexOf("/") + 1).length * 6 + 4; })
				// 		.attr("height", 14)
				// 		.attr("fill", "#fff");

				node.append("text")
						.attr("dy", 3)
						.attr("x", function(d) { return d.children ? -8 : 8; })
						.style("text-anchor", function(d) { return d.children ? "end" : "start"; })
						.text(function(d) { return d.id.substring(d.id.lastIndexOf("/") + 1); })

				d3.selectAll("input")
						.on("change", changed);

				var timeout = setTimeout(function() {
					d3.select("input[value='tree']")
							.property("checked", true)
							.dispatch("change");
				}, 1000);

				function changed() {
					timeout = clearTimeout(timeout);
					(this.value === "tree" ? tree : cluster)(root);
					var t = d3.transition().duration(750);
					node.transition(t).attr("transform", function(d) { return "translate(" + d.y + "," + d.x + ")"; });
					link.transition(t).attr("d", diagonal);
				}

				
			function diagonal(d) {
				return "M" + d.y + "," + d.x
						+ "C" + (d.parent.y + 100) + "," + d.x
						+ " " + (d.parent.y + 100) + "," + d.parent.x
						+ " " + d.parent.y + "," + d.parent.x;
			}

			</script>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function addHelloWorld(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "helloworld" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('helloworld.helloWorld', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user

		// get recursive file tree
		if (!vscode.workspace.workspaceFolders?.length) {
			vscode.window.showInformationMessage('No folder or workspace opened');
			return;
		}
		let rootPath;
		if (vscode.workspace.workspaceFolders.length > 1) {
			const quickPickResult = vscode.window.showQuickPick(
				vscode.workspace.workspaceFolders.map((folder) => folder.name),
				{
				ignoreFocusOut: true,
				placeHolder: 'Workspace folder name',
				canPickMany: false,
				title: 'Select workspace folder'
			});
			const workspaceName = await quickPickResult;
			vscode.window.showInformationMessage(`you selected ${workspaceName}`);
			const workspaceFolder = vscode.workspace.workspaceFolders.find((folder) => folder.name === workspaceName);
			rootPath = workspaceFolder!.uri.fsPath;
		} else {
			rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
		}
		const root = new FileNode(rootPath, getFilesRecursively(rootPath));
		console.log('file tree:');
		console.log(getTree(root));
	});

	context.subscriptions.push(disposable);
}


function addCatCoding(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('catCoding.start', () => {
			CatCodingPanel.createOrShow(context.extensionUri);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('catCoding.doRefactor', () => {
			if (CatCodingPanel.currentPanel) {
				CatCodingPanel.currentPanel.doRefactor();
			}
		})
	);

	if (vscode.window.registerWebviewPanelSerializer) {
		// Make sure we register a serializer in activation event
		vscode.window.registerWebviewPanelSerializer(CatCodingPanel.viewType, {
			async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: unknown) {
				console.log(`Got state: ${state}`);
				// Reset the webview options so we use latest uri for `localResourceRoots`.
				webviewPanel.webview.options = getWebviewOptions(context.extensionUri);
				CatCodingPanel.revive(webviewPanel, context.extensionUri);
			}
		});
	}
}
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	addHelloWorld(context);
	addCatCoding(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
