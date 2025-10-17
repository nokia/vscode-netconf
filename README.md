# NETCONF CLIENT for Visual Studio Code

## About

This vsCode extension implements an interactive NETCONF client, that runs
against NETCONF servers, like NOKIA IP Routers powered by SR OS and SRLinux.
By integrating NETCONF with Visual Studio Code, users will be able to extend
the industry leading open-source code editor and integrated development
environment by the ability to communicate with latest networking equipment
using the NETCONF protocol.

The extension is implemented in native TypeScript and works on your desktop
system of choice (Windows, macOS, Linux). It supports Remote SSH to simplify
connectivity to lab environments using private IP addressing via SSH jump
hosts and containerlab.

## Download

The latest packaged `.vsix` file is attached to every GitHub release and can
always be downloaded from the following stable URL:

<https://github.com/nokia/vscode-netconf/releases/latest/download/netconf-client.vsix>

## Build

To build this extension yourself, you can use
["Visual Studio Code Extensions"](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

```bash
$ git clone https://github.com/nokia/vscode-netconf
$ cd vscode-netconf
$ npm install .
$ vsce package
```

## Contributions

We are happy to have people contributing to this project. If you have feature
request or if you want to report misfunctions, feel free to raise
[Issues](https://github.com/nokia/netconf-examples/issues).

If you want to contribute code-changes, you can contribute directly via
normal pull-request procedure.

## Getting Started!

![getting-started](https://raw.githubusercontent.com/nokia/vscode-netconf/master/resources/getting-started.gif)

Netconf server settings are persisted as part of the extension settings.
For common cases like adding or deleting server entries, open the
NETCONF view from the activity bar and you will have direct access to
the server and connection list.

If you require advanced settings, like persisting the server passwords
or adjusting the client capabilities, you will find those options as
part of the extension settings.

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

**Copyright (c) 2025 NOKIA**