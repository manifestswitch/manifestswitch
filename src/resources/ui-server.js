
// These should apply both to the initial post, and any subsequent
// discovered posts

function ajaxify_comments_link() {

}

function ajaxify_parent_link() {

}

function ajaxify_child_link() {

}

function ajaxify_vote_buttons() {

}


function show_children_count() {

}


// For when the reply link is clicked
function ajaxify_reply_form() {

}

function add_stuff_to_grouproots() {
    var lis = document.getElementsByTagName('li');
    for (var i = 0, len = lis.length; i < len; ++i) {
        lis[i].innerHTML += ' <a href="https://127.0.0.1:8443/posts?parent=' + lis[i].textContent + '">comments</a>';
    }
}

function apply_list_js(roots) {
    var group = window.location.href.split('group=')[1];
    var groupHex = null;
    $('form input').each(function () {
        if (this.name === 'symKey') {
            groupHex = this.value;
        }
    });

    function linkHash(x) {
        return x.href.split('/post/')[1];
    }

    roots.each(function () {
        $(this).find('a.hash').each(function () {
            var a = this, parent = $(a).parent();
            $.getJSON(a.href, function (data) {
                function mkreplylink() {
                    var replylink = $('<a class="reply" href="/posts/form?group=' + group + '&parent=' + linkHash(a) + '">reply</a>');
                    replylink.click(function () {
                        var form = $('<form method="POST" action="/posts"><textarea name="content"></textarea><input type="hidden" name="symKey" value="' + groupHex + '"><input type="hidden" name="parent" value="' + linkHash(a) + '"><br><button class="cancel">Cancel</button><input class="submit" type="submit" value="submit"></form>');
                        form.find('input.submit').click(function () {
                            $.post('/posts',
                                   { symKey: groupHex, parent: linkHash(a), content: form.find('textarea').val() },
                                   function () {
                                       form.find('.cancel').click();
                                       parent.children('a.comments').click();
                                   });
                            return false;
                        });
                        $(this).after(form);
                        form.children('.cancel').click(function () {
                            parent.children('a.comments').after(mkreplylink);
                            form.remove();
                            return false;
                        });
                        replylink.remove();
                        return false;
                    });
                    return replylink;
                }

                var div = $('<div class="content"></div>'), replylink = mkreplylink();
                div.html(markdown.toHTML(data.data));
                div.insertBefore(a);
                // occurs after ajax because the user should want to
                // read what they're replying too
                parent.children('a.comments').after(replylink);
            });
        });
    });

    roots.find('a.comments').each(function () {
        var that = this;
        var a = $(this);
        var parent = a.parent();
        a.click(function () {
            $.getJSON(that.href,
                      function (data) {
                          a.text(data.length + ' comments');
                          var ul = parent.children('ul');
                          if (ul.length === 0) {
                              ul = $('<ul class="comments"></ul>');
                              parent.append(ul);
                          }
                          var has = ul.find('li a.hash').map(function (i, x) { return linkHash(x); }).toArray();
                          var html = '';
                          for (var i = 0,len=data.length; i < len; ++i) {
                              if (has.indexOf(data[i]) === -1) {
                                  html += '<li><a class="hash" href="/post/' + data[i] + '">' + data[i].substring(0, 8) + '</a><a class="comments" href="/posts?parent=' + data[i] + '">comments</a></li>';
                              }
                          }
                          var lis = $(html);
                          apply_list_js(lis);
                          ul.append(lis);
                      });
            return false;
        });

        $.getJSON(this.href,
                  function (data) {
                      a.text(data.length + ' comments');
                  });
    });
}

function document_onload() {
    apply_list_js($('li'));
}


document.body.onload = document_onload;
