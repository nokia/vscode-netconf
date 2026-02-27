# NETCONF CLIENT for Visual Studio Code

## About

This extension adds an interactive NETCONF client to Visual Studio Code, connecting to NETCONF servers such as NOKIA IP routers (SR OS and SRLinux). It brings NETCONF into the editor so you can manage modern network equipment directly from VS Code using the standard NETCONF protocol.

The extension is written in TypeScript and runs on Windows, macOS, and Linux. Remote SSH is supported for lab access over private networks, including via SSH jump hosts and containerlab. It has been validated with VS Code, code-server, and Cursor.

## Build

**Prerequisites:** [Node.js](https://nodejs.org/) and npm.

Clone the repository, install dependencies, and package the extension (compile runs automatically via `vscode:prepublish`). See the [VS Code publishing documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for more on `vsce` and publishing.

```bash
git clone https://github.com/nokia/vscode-netconf
cd vscode-netconf
npm install
npx vsce package
```

This produces a `.vsix` file that can be installed directly in VS Code and Cursor.

## Contributions

Contributions are welcome. Open an [issue](https://github.com/nokia/vscode-netconf/issues) for bugs or ideas, or send a pull request. We’re happy to review and merge.

## Getting Started!

![getting-started](https://raw.githubusercontent.com/nokia/vscode-netconf/master/resources/getting-started.gif)

NETCONF server settings are persisted as part of the extension settings. For common cases like adding or deleting server entries, open the NETCONF view from the activity bar and you will have direct access to
the server and connection list.

If you require advanced settings, like persisting the server passwords or adjusting the client capabilities, you will find those options as part of the extension settings.

## Supported Features

* **Support for NETCONF over SSHv2**

  [RFC 6241](https://tools.ietf.org/html/rfc6241) and
  [RFC 6242](https://tools.ietf.org/html/rfc6242) compliant NETCONF client,
  fully integrated with Visual Studio Code. Both **end-of-message framing*
  and *chunked-framing* (base:1.0 and base:1.1) are supported.
  
* **Authentication support: username/password and key-based**

* **Connection control**

  The user has control when to connect/disconnect to a NETCONF server.
  Multiple parallel NETCONF sessions are supported, while the user
  can decide, which RPC is send over which connection.
  
  This allows execute complex flows like `lock` > `edit-config` >
  `validate` > `confirmed-commit` > `confirm` > `unlock`. It's also
  an enabler to receive event notifications (see below). Detailed logs
  (per connection) are available using OUTPUT channels.

* **Support for NETCONF event notifications**

  The `vscode-netconf` extension is
  [RFC 5277](https://tools.ietf.org/html/rfc6241) compliant to receive
  NETCONF event notifications. Events will be buffered and while the
  status-bar shows the number of received events. By clicking on the
  events icon in the status-bar, a new TextDocument containing the
  buffered notifications will be opened and the buffer gets cleared.

  ![using-notifications](https://raw.githubusercontent.com/nokia/vscode-netconf/master/resources/using-notifications.gif)


* **Examples library**

  NETCONF request examples are available from
  https://github.com/nokia/netconf-examples and can be added to the `vscode`
  workspace.

  By default, the example library will be cloned to the users home directory.
  You can set the `git.defaultCloneDirectory` in the Visual Studio Code
  settings to an alternative folder like "~/Development" based on your
  personal needs.

* **Access to server SSH greetings, SSH banner**

* **Access to NETCONF `<hello/>` messages**

* **Option: Prettify XML**

  From the extension settings it is possible to activate the
  `NETCONF: prettify` option. This is useful, when NETCONF servers return
  minified XML.

* **Option: Auto-open Response Files**

  The `NETCONF: Auto-open Response Files` setting controls whether new file 
  tabs are automatically opened when NETCONF responses are received from the 
  router. When disabled, responses are still logged but won't automatically 
  open new file tabs. User-initiated actions (like clicking "Open" on 
  notifications or manually sending custom RPCs) will still open files 
  regardless of this setting. Default: enabled.

* **Option: SSH debug**

  To troubleshoot SSHv2 related issues, like handshake problems around
  ciphers, and key-exchange algorithms, SSH debugging can be enabled.
  To check the logs, use the console-view part of `Developer tools`
  (accessible from `Help`).

* **Integration with vscode-containerlab**

  Create connections to nodes managed by containerlab, without the need
  to configure connection details. Extension will use containerlab hostname,
  default user and key-based authentication. Fallback to password-based
  authentication, while user is prompted to provide connecting details.
  Default settings can be tuned as needed.

  ![using-clab](https://raw.githubusercontent.com/nokia/vscode-netconf/master/resources/using-clab.gif)

* **XML Navigator**

  The extension includes XML Navigator to navigate, view, and edit
  NETCONF requests and responses side-by-side with the text editor.

  The XML Navigator works like the Markdown preview: once you have an XML file
  open, launch it from the Command Palette or the editor title bar button. The
  Navigator opens in a split pane beside the XML editor and stays in sync with
  the active document. You only need one XML Navigator at a time; if you switch
  to a different XML document, the Navigator follows that document.

  The Navigator has no knowledge of the underlying schema (YANG or XSD). It
  detects tables automatically when it finds sibling elements with the same
  XML tag name. As a result, there is no type validation and no handling of
  concepts such as list keys.

  Use the navigation bar to browse the element tree—it builds the path segment
  by segment. Depending on context you see either Element View or Table View.
  Edits are applied to the underlying XML document and support Undo/Redo.

  Sync from editor to Navigator is not automatic: use the context menu on
  selected XML tags to update the Navigator to the corresponding path. When
  you change context or focus an input in the Navigator, it shows you the
  corresponding element or section in the editor.

  Table View lets you edit directly, spreadsheet-style. Tables are flattened to
  include nested child containers.

  *Experimental:* Multi-cell copy, paste, and delete, as well as editing nested
  tables, are still experimental and may fail or produce invalid XML. Always
  review the resulting XML after editing.

  ![using-xml-navigator](https://raw.githubusercontent.com/nokia/vscode-netconf/master/resources/using-xml-navigator.gif)


## Compatibility

Following vendors and device families have been tested so far:

| Vendor | Product Family | Router OS |
|---|---|---|
| Ciena | 5000, 8000 series | SAOS 10.9, 10.11 |
| Cisco | NCS, xrv9k series| IOS-XR 7.3, 7.9, 7.10 |
| Ericsson | 6000 series | IPOS 23.1 |
| Huawei | NetEngine 8000 series | rel 8.22 |
| Juniper | MX series | JunOS 22.4 |
| Nokia | SR families | SR OS |
| Nokia | SRL families | SR Linux |
| Ribbon | NPT-2100 | *dev-load*|
| H3C | CR16005E | *dev-load* |
| Arista | cEOS | EOS 4.33 |


We don't mind to get access to 3rd party equipment (preferred virtual
router/simulator images as virtual-machine or docker), test licenses and
some basic instructions to extend the scope of our testing, improve
compatibility and extend the capabilities.

## Known issues

* NETCONF responses are opened as new `TextDocument`. Visual Studio Code is
  automatically setting the `isDirty` tag, while you can't simple close the
  document as the `Save As` dialogue will always show up.

  Related to vscode-issue [#154664](https://github.com/microsoft/vscode/issues/154664).

* NETCONF responses will open as `Untitled TextDocument`. It's not possible
  to provide meaningful tab-names. Ideally, we would pre-define a file://
  location, that it could be saved by simply doing CTRL-S / CMD-S without
  `Save As` popup.

  Related to vscode-issue [#41909](https://github.com/microsoft/vscode/issues/41909).

* The vscode-netconf extension uses the API methods `showInformationMessage()`,
  `showWarningMessage()`, and `showErrorMessage()`. Messages are displayed as plain
  text without differentiation between message title and details and there is no
  possibility to show preformatted text and enforce line-breaks. In consequence,
  SSH banners are not displayed very nicely.

## License

This project is licensed under the BSD 3-Clause license - see the
[LICENSE](https://github.com/nokia/vscode-netconf/blob/master/LICENSE).

**Copyright (c) 2026 NOKIA**