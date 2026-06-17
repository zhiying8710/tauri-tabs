## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`tabs:allow-emit-to-host`

</td>
<td>

Enables the emit_to_host command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`tabs:deny-emit-to-host`

</td>
<td>

Denies the emit_to_host command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`tabs:allow-emit-to-webview`

</td>
<td>

Enables the emit_to_webview command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`tabs:deny-emit-to-webview`

</td>
<td>

Denies the emit_to_webview command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`tabs:allow-eval-webview`

</td>
<td>

Enables the eval_webview command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`tabs:deny-eval-webview`

</td>
<td>

Denies the eval_webview command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`tabs:allow-navigate-webview`

</td>
<td>

Enables the navigate_webview command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`tabs:deny-navigate-webview`

</td>
<td>

Denies the navigate_webview command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`tabs:allow-open-devtools`

</td>
<td>

Enables the open_devtools command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`tabs:deny-open-devtools`

</td>
<td>

Denies the open_devtools command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`tabs:default`

</td>
<td>

Host controls plus the guest upstream channel.

</td>
</tr>

<tr>
<td>

`tabs:host`

</td>
<td>

Allows the main UI webview to drive child tab webviews: navigate, push messages, eval scripts and open devtools.

</td>
</tr>

<tr>
<td>

`tabs:guest`

</td>
<td>

Allows a child tab webview to push one ipc-message up to the host.

</td>
</tr>
</table>
