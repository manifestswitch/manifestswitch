
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

function document_onload() {
    var x = false;
    $('li').each(function () {
        var that = this;
        $(this).find('a').each(function () {
            $.getJSON('/post/' + this.textContent, function (data) {
                if (!x) alert(data);
                x = false;
            });
        });
    })

    alert(5);
}


document.body.onload = document_onload;
